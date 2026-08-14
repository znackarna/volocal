//! What is running: the queue, cancelling it, and the child processes a run owns.
//!
//! One stage of the pipeline, lifted out of transcription.rs unchanged when
//! that file had grown to 3 626 lines. Its tests came with it.

use super::*;

// ---------------------------------------------------------------- running jobs

/// Work in progress: which recordings have a worker, and what each one has
/// running right now.
///
/// Cancelling used to be answered by the process registry — whether a `Child`
/// happened to be sitting in a map. Only whisper was ever put there, so
/// pressing `Zrušit` during preparation or during speaker recognition found
/// nothing, reported that nothing was running, and *cleared its own request*,
/// while the run carried on and finished. The registry now answers a different
/// question than the one cancellation asks: `running` says whether there is a
/// job, `processes` says what to kill.
#[derive(Default, Clone)]
pub struct TranscriptionTask {
    /// Children spawned for a recording, newest last. A run passes through
    /// several programs, so this is a list rather than one handle: replacing
    /// a stored `Child` used to drop the previous one without killing it.
    processes: Arc<Mutex<HashMap<String, Vec<std::process::Child>>>>,
    /// Recordings with a live worker thread, whether it is transcribing or
    /// only recognising speakers.
    running: Arc<Mutex<HashSet<String>>>,
    cancellations: Arc<Mutex<HashSet<String>>>,
    /// The heavy runs wait for each other here, in the order they arrived.
    gate: Arc<Gate>,
}

/// One whisper (or sherpa) at a time.
///
/// Two of them on one graphics card do not share it, they take memory from
/// each other and both finish later than either would alone — and a batch
/// from the watched folder used to start every file at once. The queue is
/// arrival order, so ten dropped files are transcribed in the order they were
/// dropped.
#[derive(Default)]
pub(crate) struct Gate {
    order: Mutex<VecDeque<String>>,
    turn: Condvar,
}

impl TranscriptionTask {
    pub(crate) fn begin(&self, id: &str) {
        self.running.lock().unwrap().insert(id.to_string());
    }

    /// Takes a place in the queue. True means somebody is ahead of it, which
    /// is what the interface needs in order to say so.
    pub(crate) fn enqueue(&self, id: &str) -> bool {
        let mut order = self.gate.order.lock().unwrap();
        order.push_back(id.to_string());
        order.len() > 1
    }

    /// Blocks until this recording stands at the front. `false` means it was
    /// taken out of the queue while it waited — cancelled — and must not run.
    pub(crate) fn wait_for_turn(&self, id: &str) -> bool {
        let mut order = self.gate.order.lock().unwrap();
        loop {
            match order.front() {
                Some(front) if front == id => return true,
                _ if !order.iter().any(|waiting| waiting == id) => return false,
                _ => order = self.gate.turn.wait(order).unwrap(),
            }
        }
    }

    /// Leaves the queue and wakes whoever is next. Called by the worker once
    /// its own run is over, whatever the outcome.
    pub(crate) fn leave_queue(&self, id: &str) {
        self.gate
            .order
            .lock()
            .unwrap()
            .retain(|waiting| waiting != id);
        self.gate.turn.notify_all();
    }

    /// Takes a *waiting* recording out of the queue. The one at the front is
    /// left alone on purpose: it is the run that is happening, and removing it
    /// would let the next one start beside it rather than after it.
    fn leave_queue_if_waiting(&self, id: &str) {
        let mut order = self.gate.order.lock().unwrap();
        if order.front().map(|front| front.as_str()) == Some(id) {
            return;
        }
        order.retain(|waiting| waiting != id);
        drop(order);
        self.gate.turn.notify_all();
    }
    /// Is a worker already busy with this recording? Asked before a second one
    /// is started: the database row is not a reliable answer on its own,
    /// because a run only reaches it a moment later.
    pub fn is_running(&self, id: &str) -> bool {
        self.running.lock().unwrap().contains(id)
    }
    /// Is any recording being worked on at all?
    ///
    /// Asked by the module listing, which needs to know whether the tools a
    /// transcription uses may be deleted — *zámek jen u těch, které se
    /// aktuálně používají*. It deliberately does not say *which* recording or
    /// *which* stage: one worker runs ffmpeg, whisper and sherpa in turn and
    /// writes down none of it, so the only honest answer while a job is alive
    /// is that everything a job touches may be in use.
    pub fn anything_running(&self) -> bool {
        !self.running.lock().unwrap().is_empty()
    }
    /// Kills every registered child, for when the window is closing.
    ///
    /// `std::process::Child` does not kill on `Drop`, and the worker threads
    /// are detached — so closing the window during a transcription left
    /// `whisper-cli` (or `sherpa-onnx`) running, holding the graphics card and
    /// writing into `%TEMP%\whisp\<id>`, which the next start deletes from
    /// under it. Nothing on screen said the work was still going, because
    /// there was no screen.
    ///
    /// Returns how many it had to kill, which is what the test asserts on.
    pub fn kill_all(&self) -> usize {
        let mut processes = self.processes.lock().unwrap();
        let mut killed = 0;
        for children in processes.values_mut() {
            for child in children.iter_mut() {
                // Already gone is the ordinary case, not a failure: a run that
                // finished cleanly leaves its handle here until `cleanup`.
                if child.try_wait().ok().flatten().is_none() && child.kill().is_ok() {
                    let _ = child.wait();
                    killed += 1;
                }
            }
        }
        processes.clear();
        killed
    }
    pub(crate) fn record_process(&self, id: &str, child: std::process::Child) {
        self.processes
            .lock()
            .unwrap()
            .entry(id.to_string())
            .or_default()
            .push(child);
    }
    /// Takes back the most recently recorded child, to wait on it. Nothing is
    /// there if cancellation already killed and removed it.
    pub(crate) fn take_process(&self, id: &str) -> Option<std::process::Child> {
        self.processes.lock().unwrap().get_mut(id)?.pop()
    }
    pub(crate) fn was_cancelled(&self, id: &str) -> bool {
        self.cancellations.lock().unwrap().contains(id)
    }

    /// Stops a running job. Returns whether there was one.
    ///
    /// The flag is what stops the run; killing the child only saves the wait.
    /// The flag is therefore never cleared here — only `cleanup` does that,
    /// when the worker itself has finished.
    pub fn cancel(&self, id: &str) -> bool {
        self.cancellations.lock().unwrap().insert(id.to_string());
        // A run that has not started yet is stopped by leaving the queue; its
        // worker wakes, finds itself gone, and reports the cancellation.
        self.leave_queue_if_waiting(id);
        if let Some(children) = self.processes.lock().unwrap().remove(id) {
            for mut child in children {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        self.is_running(id)
    }

    /// Clears the cancel flag without stopping anything.
    pub fn forget_cancellation(&self, id: &str) {
        self.cancellations.lock().unwrap().remove(id);
    }

    pub(crate) fn cleanup(&self, id: &str) {
        self.forget_cancellation(id);
        self.processes.lock().unwrap().remove(id);
        self.running.lock().unwrap().remove(id);
    }
}

/// A `CommandRunner` that puts each child into the job's registry, so that
/// `Zrušit` reaches the preparation programs and not only whisper.
///
/// Waiting is done by reading stderr to its end rather than by holding the
/// child: the pipe closes when the process does, whether it finished or was
/// killed, and only then is the child taken back out of the registry. If it
/// is no longer there, cancellation took it — the same handshake
/// `start_whisper` has always used.
pub(crate) struct JobRunner<'a> {
    pub(crate) task: &'a TranscriptionTask,
    pub(crate) recording_id: &'a str,
}

impl tools::CommandRunner for JobRunner<'_> {
    fn run(
        &self,
        mut command: std::process::Command,
    ) -> std::io::Result<Option<(std::process::ExitStatus, String)>> {
        let mut child = command
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()?;
        let stderr = child.stderr.take().unwrap();
        self.task.record_process(self.recording_id, child);
        let mut text = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut text);
        match self.task.take_process(self.recording_id) {
            Some(mut child) => Ok(Some((child.wait()?, text.trim().to_string()))),
            None => Ok(None),
        }
    }
}

/// Give up between stages when the run has been cancelled.
///
/// The message is never read: the worker checks the cancel flag before it
/// looks at the result, and reports the run as cancelled rather than failed.
pub(crate) fn stop_if_cancelled(task: &TranscriptionTask, id: &str) -> Reported<()> {
    if task.was_cancelled(id) {
        return Err(UserMessage::new("transcription.cancelled"));
    }
    Ok(())
}

#[cfg(test)]
mod queue_tests {
    use super::*;

    #[test]
    fn the_second_recording_waits_for_the_first() {
        let task = TranscriptionTask::default();
        assert!(!task.enqueue("a"), "nobody is ahead of the first one");
        assert!(task.enqueue("b"), "the second one has somebody ahead of it");
        assert!(task.wait_for_turn("a"), "the front runs at once");
        task.leave_queue("a");
        assert!(task.wait_for_turn("b"), "and the next one follows it");
    }

    /// Proves the queue actually blocks: without it `b` would return
    /// immediately and the two runs would share the graphics card.
    #[test]
    fn a_waiting_worker_wakes_when_the_one_ahead_leaves() {
        use std::sync::mpsc;
        use std::time::Duration;

        let task = TranscriptionTask::default();
        task.enqueue("a");
        task.enqueue("b");
        let (sender, receiver) = mpsc::channel();
        let waiting = task.clone();
        let worker = std::thread::spawn(move || {
            let _ = sender.send(waiting.wait_for_turn("b"));
        });

        assert!(
            receiver.recv_timeout(Duration::from_millis(150)).is_err(),
            "b must still be waiting while a holds the front"
        );
        task.leave_queue("a");
        assert!(
            receiver.recv_timeout(Duration::from_secs(2)).unwrap(),
            "leaving the queue wakes the next one"
        );
        worker.join().unwrap();
    }

    #[test]
    fn cancelling_a_waiting_recording_takes_it_out_of_the_queue() {
        let task = TranscriptionTask::default();
        task.enqueue("a");
        task.begin("a");
        task.enqueue("b");
        task.begin("b");

        task.cancel("b");
        assert!(
            !task.wait_for_turn("b"),
            "a cancelled waiting run is gone and must not start"
        );
        assert!(task.wait_for_turn("a"), "the front is untouched by it");
    }

    /// Cancelling the run that is *happening* must not remove it from the
    /// front: the next one would then start beside it rather than after it.
    #[test]
    fn cancelling_the_running_recording_leaves_it_at_the_front() {
        let task = TranscriptionTask::default();
        task.enqueue("a");
        task.begin("a");
        task.enqueue("b");
        task.begin("b");

        task.cancel("a");
        assert!(
            task.wait_for_turn("a"),
            "still the front until its worker ends"
        );
        task.leave_queue("a");
        assert!(task.wait_for_turn("b"));
    }
}

#[cfg(test)]
mod cancellation_tests {
    use super::*;

    /// The defect: pressing Zrušit while ffmpeg was converting found no child,
    /// answered "nothing is running", and cleared the request it had just made.
    #[test]
    fn cancelling_between_programs_still_stops_the_run() {
        let task = TranscriptionTask::default();
        task.begin("a");
        assert!(
            task.cancel("a"),
            "a worker is running, so there is something to cancel"
        );
        assert!(task.was_cancelled("a"), "the request must survive the call");
        assert!(stop_if_cancelled(&task, "a").is_err());
    }

    /// What the module listing asks before it draws a bin: is anything at all
    /// running? It is the same set `is_running` reads, asked without a name.
    #[test]
    fn the_registry_says_whether_anything_at_all_is_running() {
        let task = TranscriptionTask::default();
        assert!(
            !task.anything_running(),
            "an idle application locks nothing"
        );

        task.begin("a");
        assert!(task.anything_running());
        assert!(
            !task.is_running("b"),
            "which is not the same question as whether one particular recording is"
        );

        task.begin("b");
        task.cleanup("a");
        assert!(task.anything_running(), "the second one is still going");
        task.cleanup("b");
        assert!(
            !task.anything_running(),
            "and the lock comes off when the last worker ends"
        );
    }

    #[test]
    fn a_run_that_has_already_finished_reports_nothing_to_cancel() {
        let task = TranscriptionTask::default();
        task.begin("a");
        task.cleanup("a");
        assert!(!task.cancel("a"));
    }

    #[test]
    fn a_new_run_does_not_inherit_the_previous_cancellation() {
        let task = TranscriptionTask::default();
        task.begin("a");
        task.cancel("a");
        task.cleanup("a");
        task.begin("a");
        assert!(!task.was_cancelled("a"));
        assert!(stop_if_cancelled(&task, "a").is_ok());
    }

    /// One recording runs several programs in turn. Storing one handle per
    /// recording dropped the previous `Child` without killing it, which is how
    /// an orphaned whisper could keep writing while a second one started.
    #[test]
    fn every_program_of_a_run_is_kept_not_only_the_last() {
        let task = TranscriptionTask::default();
        let spawn = || {
            std::process::Command::new(std::env::current_exe().unwrap())
                .arg("--list")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap()
        };
        task.record_process("a", spawn());
        task.record_process("a", spawn());
        for _ in 0..2 {
            let mut child = task.take_process("a").expect("both children are kept");
            let _ = child.wait();
        }
        assert!(task.take_process("a").is_none());

        task.begin("a");
        task.record_process("a", spawn());
        assert!(task.cancel("a"));
        assert!(
            task.take_process("a").is_none(),
            "cancelling kills and removes whatever was running"
        );
    }

    /// Closing the window during a transcription used to leave the program
    /// running. Nothing asked it to stop: `Child` does not kill on `Drop` and
    /// the worker thread is detached.
    ///
    /// The death is observed rather than inferred. The child's stdout pipe is
    /// held open for as long as the child lives, so reading it to EOF is the
    /// question "is it gone?" — and it is asked on another thread with a
    /// timeout, because a test that hangs when it regresses is worse than no
    /// test at all. An earlier version of this test asserted only on counts
    /// and passed against a `kill_all` that merely forgot the children.
    #[test]
    fn closing_the_window_kills_what_is_still_running() {
        use std::io::Read;

        let task = TranscriptionTask::default();
        let spawn = || {
            let mut program = std::process::Command::new(std::env::current_exe().unwrap());
            program.args([
                "--exact",
                "transcription::jobs::cancellation_tests::stands_in_for_a_long_program",
                "--ignored",
                "--test-threads=1",
            ]);
            let mut child = program
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap();
            let pipe = child.stdout.take().unwrap();
            (child, pipe)
        };
        let (first, first_pipe) = spawn();
        let (second, second_pipe) = spawn();
        task.record_process("a", first);
        task.record_process("b", second);

        let (tell, hear) = std::sync::mpsc::channel();
        for pipe in [first_pipe, second_pipe] {
            let tell = tell.clone();
            std::thread::spawn(move || {
                let mut pipe = pipe;
                let mut sink = Vec::new();
                // Returns when the write end closes, which happens when the
                // process ends and not before.
                let _ = pipe.read_to_end(&mut sink);
                let _ = tell.send(());
            });
        }

        let killed = task.kill_all();
        assert_eq!(killed, 2, "both programs were running and both had to go");

        // The stand-in sleeps for 30 seconds. Five is far past a kill and far
        // short of it finishing on its own.
        for which in 0..2 {
            hear.recv_timeout(std::time::Duration::from_secs(5))
                .unwrap_or_else(|_| panic!("program {which} was still running after kill_all"));
        }

        assert!(
            task.take_process("a").is_none() && task.take_process("b").is_none(),
            "nothing is left behind to be killed twice"
        );
        assert_eq!(task.kill_all(), 0);
    }

    /// Not a test. It is a stand-in for a long program — ffmpeg encoding a
    /// 34-minute MP3 — spawned by the test below, which then kills it. The
    /// test binary is the one program certain to exist on every platform this
    /// is built for.
    #[test]
    #[ignore = "spawned by cancelling_a_preparation_program_kills_it"]
    fn stands_in_for_a_long_program() {
        std::thread::sleep(std::time::Duration::from_secs(30));
    }

    /// `Zrušit` during `Připravuji přesné přehrávání` did nothing: the
    /// preparation programs were run with `Command::output`, which hands the
    /// child to nobody, so there was nothing to kill and the encode ran on.
    #[test]
    fn cancelling_a_preparation_program_kills_it() {
        let task = TranscriptionTask::default();
        task.begin("a");

        let mut program = std::process::Command::new(std::env::current_exe().unwrap());
        program.args([
            "--exact",
            "transcription::jobs::cancellation_tests::stands_in_for_a_long_program",
            "--ignored",
            "--test-threads=1",
        ]);

        let running = task.clone();
        let worker = std::thread::spawn(move || {
            use crate::tools::CommandRunner;
            JobRunner {
                task: &running,
                recording_id: "a",
            }
            .run(program)
        });

        // Wait for the child to be registered rather than guessing at a delay:
        // killing before the spawn would prove nothing.
        let started = std::time::Instant::now();
        while task
            .processes
            .lock()
            .unwrap()
            .get("a")
            .is_none_or(Vec::is_empty)
        {
            assert!(
                started.elapsed().as_secs() < 10,
                "the stand-in never started"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        assert!(task.cancel("a"));
        let outcome = worker.join().expect("the runner thread does not panic");
        assert!(
            matches!(outcome, Ok(None)),
            "a killed program reports that it was killed, not an exit code"
        );
        assert!(
            started.elapsed().as_secs() < 25,
            "it stopped when it was told, not when it would have finished on its own"
        );
    }
}
