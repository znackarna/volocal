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
