# volocal-cli

Installed beside the application, in the same folder.

*Generated from the program's own help. After changing a command, run*
`UPDATE_CLI_DOCS=1 cargo test --manifest-path src-tauri/Cargo.toml --bin volocal-cli`.

## volocal-cli

```text
Volocal's archive from the command line.

Works on the same archive as the Volocal window: what you list or export here is what the window shows. Start Volocal once first, which creates the archive and downloads what transcription needs.

Usage: volocal-cli <COMMAND>

Commands:
  status        Show where the archive is and what is installed
  transcribe    Add an audio or video file to the archive and transcribe it
  list          List recordings, newest first
  show          Show one recording in detail
  export        Write a recording's transcript to a file
  export-audio  Write a recording's audio to a file
  help          Print this message or the help of the given subcommand(s)

Options:
  -h, --help
          Print help (see a summary with '-h')

  -V, --version
          Print version
```

## status

```text
Show where the archive is and what is installed

Usage: status

Options:
  -h, --help
          Print help
```

## transcribe

```text
Add an audio or video file to the archive and transcribe it.

Uses the model and the other choices made in the Volocal window. A second language heard in the recording is written in as well. Progress goes to the error stream; when it is done, the new recording's id is printed, ready for `export`. Ctrl+C stops the transcription and keeps the recording in the archive.

Usage: transcribe [OPTIONS] <FILE>

Arguments:
  <FILE>
          The file to transcribe

Options:
      --language <LANGUAGE>
          The language spoken, as a code such as cs or en [default: the window's choice]

      --speakers <COUNT>
          Tell the speakers apart, and how many there are; 0 when you do not know [default: as set in the window]

  -h, --help
          Print help (see a summary with '-h')
```

## list

```text
List recordings, newest first

Usage: list [OPTIONS]

Options:
      --search <SEARCH>
          Show only recordings whose transcript contains this text

      --folder <FOLDER>
          Show only recordings in the folder with this name

  -h, --help
          Print help
```

## show

```text
Show one recording in detail

Usage: show <ID>

Arguments:
  <ID>
          The recording's id, or the first few characters of it

Options:
  -h, --help
          Print help
```

## export

```text
Write a recording's transcript to a file

Usage: export [OPTIONS] --format <FORMAT> <ID>

Arguments:
  <ID>
          The recording's id, or the first few characters of it

Options:
      --format <FORMAT>
          The format to write

          Possible values:
          - txt:  Plain text
          - md:   Markdown, with speakers and times
          - srt:  Subtitles for editors and players
          - vtt:  Subtitles for the web
          - json: Everything in the transcript, for further processing

      --out <OUT>
          Where to write it [default: the recording's title, here]

      --force
          Overwrite the file if it already exists

  -h, --help
          Print help (see a summary with '-h')
```

## export-audio

```text
Write a recording's audio to a file

Usage: export-audio [OPTIONS] --format <FORMAT> <ID>

Arguments:
  <ID>
          The recording's id, or the first few characters of it

Options:
      --format <FORMAT>
          The format to write
          
          [possible values: mp3, m4a, wav]

      --out <OUT>
          Where to write it [default: the recording's title, here]

      --force
          Overwrite the file if it already exists

  -h, --help
          Print help
```

## For scripts

- **The result goes to standard output, everything else to standard error.**
  `transcribe` prints the new recording's id and nothing more; `export` and
  `export-audio` print the path they wrote. Progress and errors go to standard
  error, so `id=$(volocal-cli transcribe talk.mp3)` captures the id alone.
- **Exit codes.** `0` when the command did what it was asked. `1` when it could
  not; the reason is the last line on standard error, starting `error:`. `2`
  when the command line itself was wrong, such as an unknown option.
- **Ids.** A command that takes an id also takes its first few characters, as
  long as only one recording starts with them. `list` prints eight.
- **Nothing is overwritten** without `--force`; the command fails instead.
- **One transcription at a time.** `transcribe` fails at once while anything in
  the archive is being transcribed, from the window or from another
  `volocal-cli`.
- **Ctrl+C** stops a transcription and ends with `1`. The recording stays in
  the archive; its transcript is kept only if one had been saved before the
  key.
- **Progress** goes to standard error: one line per step when it goes to a
  file. In a terminal it is a block redrawn in place, with the text printed
  above it as it is transcribed.
- **In a terminal** every command lays out and colours what it prints, in the
  system's language when that is Czech, and an error is a sentence rather than
  an `error:` line. What a script reads, from a pipe or a file, is the plain
  English described here; `NO_COLOR` gives it in a terminal too.
- **`list`** prints one recording per line, its fields separated by two
  spaces: id, date, length, status, title. With `--search`, one match per
  line: id, time in the recording, title, the matching text.
- **Diagnostics** go to `volocal-log.txt` beside the archive, the file the
  window writes too.
