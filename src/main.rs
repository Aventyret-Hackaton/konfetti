use konfetti::{COLORS, Vm, compile, parse};
use std::fmt::Display;
use std::fs::{self, File};
use std::io::{self, BufWriter, IsTerminal, LineWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::process::exit;

const USAGE: &str = "usage: konfetti [--trace] <program.kft>
       konfetti build <program.kft> -o <out>
       konfetti build <program.kft> --html -o <out.html>

Input comes from stdin, output goes to stdout.
--trace prints every step and both stacks to stderr.
build writes a standalone executable that runs the program, or with --html
a single web page that runs it. Neither needs konfetti installed.";

fn fail(path: &str, e: impl Display) -> ! {
    eprintln!("konfetti: {path}: {e}");
    exit(1)
}

fn main() {
    // A built program is this executable with the source on the end.
    let own = std::env::current_exe().and_then(File::open).and_then(|mut f| embedded(&mut f));
    if let Ok(Some(src)) = own {
        let name = std::env::args().next().unwrap_or_default();
        let src = String::from_utf8(src).unwrap_or_else(|e| fail(&name, e));
        return run(&name, &src, false);
    }

    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        ["build", ref rest @ ..] => build(rest),
        [p] if !p.starts_with('-') => run(p, &read(p), false),
        ["--trace", p] => run(p, &read(p), true),
        _ => usage(),
    }
}

fn usage() -> ! {
    eprintln!("{USAGE}");
    exit(2)
}

fn read(path: &str) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| fail(path, e))
}

fn run(path: &str, src: &str, trace: bool) {
    let bits = parse(src).unwrap_or_else(|e| fail(path, e));
    let mut vm = Vm::new(compile(&bits, !trace));

    let mut inp = io::stdin().lock();
    let stdout = io::stdout().lock();
    // At a terminal, show output as it happens; in a pipe, batch it.
    let mut out: Box<dyn Write> = if io::stdin().is_terminal() || trace {
        Box::new(LineWriter::new(stdout))
    } else {
        Box::new(BufWriter::with_capacity(1 << 16, stdout))
    };

    let result = if trace { run_traced(&mut vm, &bits, &mut inp, &mut out) } else { vm.run(u64::MAX, &mut inp, &mut out).map(drop) };
    if let Err(e) = result.and_then(|()| out.flush()) {
        // A closed pipe (`konfetti x.kft | head`) is a normal way to stop.
        if e.kind() != io::ErrorKind::BrokenPipe {
            fail(path, e);
        }
    }
}

fn run_traced(vm: &mut Vm, bits: &[konfetti::Bit], inp: &mut impl Read, out: &mut impl Write) -> io::Result<()> {
    while let Some(i) = vm.cur() {
        let b = bits[i as usize];
        vm.run(1, inp, out)?;
        eprintln!("bit {i:<4} {:<7} ({}, {})  main {:?}  stash {:?}", COLORS[b.color as usize], b.x, b.y, vm.main, vm.stash);
    }
    Ok(())
}

fn build(args: &[&str]) {
    let (mut path, mut out, mut html) = (None, None, false);
    let mut it = args.iter();
    while let Some(&a) = it.next() {
        match a {
            "--html" if !html => html = true,
            "-o" if out.is_none() => out = Some(*it.next().unwrap_or_else(|| usage())),
            p if !p.starts_with('-') && path.is_none() => path = Some(p),
            _ => usage(),
        }
    }
    let (Some(path), Some(out)) = (path, out) else { usage() };

    let src = read(path);
    // A program that does not load should fail here, not on someone else's machine.
    if let Err(e) = parse(&src) {
        fail(path, e);
    }
    let result = if html {
        let name = Path::new(path).file_stem().unwrap_or_default().to_string_lossy();
        fs::write(out, app_html(&name, &src))
    } else {
        write_exe(out, &src)
    };
    if let Err(e) = result {
        fail(out, e);
    }
}

// ---- standalone executable: this executable, the source, a trailer ----

const MAGIC: &[u8; 8] = b"\x89KFTexe\n";

/// The source followed by its length and the magic, to go on the end of the executable.
fn with_trailer(src: &[u8]) -> Vec<u8> {
    [src, &(src.len() as u64).to_le_bytes(), MAGIC].concat()
}

/// The source on the end of an executable, if it has one.
fn embedded(f: &mut (impl Read + Seek)) -> io::Result<Option<Vec<u8>>> {
    let size = f.seek(SeekFrom::End(0))?;
    if size < 16 {
        return Ok(None);
    }
    let mut tail = [0u8; 16];
    f.seek(SeekFrom::Start(size - 16))?;
    f.read_exact(&mut tail)?;
    let len = u64::from_le_bytes(tail[..8].try_into().unwrap());
    if &tail[8..] != MAGIC || len > size - 16 {
        return Ok(None);
    }
    let mut src = vec![0; len as usize];
    f.seek(SeekFrom::Start(size - 16 - len))?;
    f.read_exact(&mut src)?;
    Ok(Some(src))
}

fn write_exe(out: &str, src: &str) -> io::Result<()> {
    // Written beside the output and renamed over it, so the output is always a
    // new file: macOS kills an executable whose file was rewritten in place
    // after it ran. Bytes after the end of a signed Mach-O leave its signature
    // good enough to run here, but codesign rejects the file, so it cannot be
    // re-signed or notarised for anyone else.
    let tmp = format!("{out}.konfetti-tmp");
    let made = (|| {
        let exe = std::env::current_exe()?;
        let mut bytes = fs::read(&exe)?;
        bytes.extend(with_trailer(src.as_bytes()));
        fs::write(&tmp, bytes)?;
        // The mode goes on after the bytes: konfetti itself may be read-only
        // (Homebrew and Nix install it 0555), and the copy must run like it.
        fs::set_permissions(&tmp, fs::metadata(&exe)?.permissions())?;
        fs::rename(&tmp, out)
    })();
    if made.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    made
}

// ---- standalone web page: the source, the wasm runtime, a small page ----

/// Built by `make` before this executable is.
const WASM: &[u8] = include_bytes!("../web/konfetti.wasm");

fn app_html(name: &str, src: &str) -> String {
    let (name, src, wasm) = (escape(name), escape(src), base64(WASM));
    let mut parts = APP.split('§');
    let mut html = parts.next().unwrap().to_string();
    for (part, fill) in parts.zip([&name, &name, &src, &wasm]) {
        html += fill;
        html += part;
    }
    html
}

fn escape(s: &str) -> String {
    // The HTML parser turns a bare CR into LF, which would split lines the CLI keeps whole;
    // a character reference survives as a CR.
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('\r', "&#13;")
}

fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = c.iter().fold(0u32, |n, &b| n << 8 | b as u32) << (8 * (3 - c.len()));
        for i in 0..4 {
            s.push(if i <= c.len() { ABC[(n >> (18 - 6 * i)) as usize & 63] as char } else { '=' });
        }
    }
    s
}

/// The page. Each `§` is a slot: name, name, source, wasm as base64.
const APP: &str = r##"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>§</title>
<link rel="icon" href="data:,">
<style>
  :root { color-scheme: light dark; --bg: #fffdf7; --ink: #20222c; --dim: #5a5e70; --box: #fff; --line: #c9c4b6; --go: #2447d8; --err: #b3261e; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #17181f; --ink: #f1efe8; --dim: #b3b6c6; --box: #22242e; --line: #4a4d5c; --go: #3f5fee; --err: #ff8a80; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--bg); }
  /* The palette, in opcode order, as a strip of confetti. */
  body::before { content: ""; display: block; height: 10px; background: linear-gradient(90deg,
    #d2103a 0 7.7%, #f16603 0 15.4%, #ffff00 0 23.1%, #28b260 0 30.8%, #00f0ff 0 38.5%, #195cec 0 46.2%, #7a0a9e 0 53.8%,
    #ff659a 0 61.5%, #ffffff 0 69.2%, #1c1c1c 0 76.9%, #6e3104 0 84.6%, #9ca8ac 0 92.3%, #ffb300 0); }
  main { max-width: 40rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
  h1 { margin: 0; font-size: 2rem; letter-spacing: -.02em; overflow-wrap: anywhere; }
  .by { margin: 0 0 1.5rem; color: var(--dim); }
  label, h2 { display: block; margin: 1.25rem 0 .25rem; font-size: .8rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--dim); }
  textarea, pre { display: block; width: 100%; margin: 0; padding: .6rem .75rem; font: .95rem/1.45 ui-monospace, monospace;
                  color: var(--ink); background: var(--box); border: 1px solid var(--line); border-radius: 10px; }
  textarea { min-height: 6.5em; resize: vertical; }
  pre { min-height: 2.8em; max-height: 60vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
  .row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-top: .75rem; }
  button { font: inherit; font-weight: 600; min-height: 2.75rem; padding: 0 1.4rem; color: var(--ink); background: var(--box);
           border: 1px solid var(--line); border-radius: 999px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  #run { color: #fff; background: var(--go); border-color: var(--go); }
  :focus-visible { outline: 3px solid var(--go); outline-offset: 2px; }
  #status { color: var(--dim); }
  #status.err { color: var(--err); }
  details { margin-top: 2rem; color: var(--dim); }
  summary { cursor: pointer; font-weight: 600; }
  details pre { margin-top: .5rem; white-space: pre; }
</style>
</head>
<body>
<main>
  <h1>§</h1>
  <p class="by">A konfetti program.</p>
  <label for="input">Input</label>
  <textarea id="input" autocomplete="off" spellcheck="false"></textarea>
  <div class="row">
    <button id="run" type="button" disabled>Run</button>
    <button id="stop" type="button" disabled>Stop</button>
    <span id="status" role="status">Loading…</span>
  </div>
  <h2 id="outlabel">Output</h2>
  <pre id="output" aria-labelledby="outlabel" aria-live="polite" tabindex="0"></pre>
  <details>
    <summary>The program</summary>
    <pre id="src" tabindex="0">§</pre>
  </details>
</main>
<script>
(async () => {
  const $ = id => document.getElementById(id);
  const say = (text, err) => { $('status').textContent = text; $('status').className = err ? 'err' : ''; };
  try {
    const wasm = Uint8Array.from(atob('§'), c => c.charCodeAt(0));
    const kf = (await WebAssembly.instantiate(wasm)).instance.exports;
    const enc = new TextEncoder(), dec = new TextDecoder();
    // Rebuilt on every read: the wasm memory can move when it grows. Only the last 256 KB are
    // shown, so a program that prints without end cannot slow the page until Stop stops working.
    const output = () => {
      const n = kf.kf_out_len(), k = Math.min(n, 1 << 18);
      return (k < n ? '…' : '') + dec.decode(new Uint8Array(kf.memory.buffer, kf.kf_out() + n - k, k));
    };
    let stop = false;

    $('run').onclick = async () => {
      const src = enc.encode($('src').textContent), input = enc.encode($('input').value);
      const p = kf.kf_buf(src.length + input.length);
      new Uint8Array(kf.memory.buffer, p, src.length + input.length).set(src);
      new Uint8Array(kf.memory.buffer, p + src.length, input.length).set(input);
      if (kf.kf_load(src.length, 1) !== 0) return say(output(), true);

      stop = false;
      $('run').disabled = true; $('stop').disabled = false;
      $('output').textContent = '';
      say('Running…');
      let halted = false, shown = 0;
      try {
        while (!halted && !stop) {
          for (const end = performance.now() + 12; !halted && performance.now() < end;) halted = kf.kf_run(1000000) === 1;
          if (kf.kf_out_len() !== shown) { shown = kf.kf_out_len(); $('output').textContent = output(); }
          // Let the page draw and the Stop button work.
          await new Promise(r => setTimeout(r));
        }
        say(halted ? 'Done.' : 'Stopped.');
      } catch (e) {
        say('The program crashed: ' + e.message, true);
      }
      $('run').disabled = false; $('stop').disabled = true;
    };
    $('stop').onclick = () => { stop = true; };
    $('input').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('run').click(); };
    $('run').disabled = false;
    say('Ready.');
  } catch (e) {
    say('Could not start: ' + e.message, true);
  }
})();
</script>
</body>
</html>
"##;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn trailer_round_trips() {
        for src in ["", "red 0 0\n", "# é\nwhite 1 2\n"] {
            let mut exe = b"not really an executable".to_vec();
            exe.extend(with_trailer(src.as_bytes()));
            assert_eq!(embedded(&mut Cursor::new(exe)).unwrap().as_deref(), Some(src.as_bytes()));
        }
    }

    #[test]
    fn no_trailer_is_not_a_program() {
        let find = |bytes: &[u8]| embedded(&mut Cursor::new(bytes.to_vec())).unwrap();
        assert_eq!(find(b""), None);
        assert_eq!(find(b"short"), None);
        assert_eq!(find(b"an ordinary executable, long enough to hold a trailer"), None);
        // The magic alone is not enough: the length must fit in the file.
        let mut lying = 1000u64.to_le_bytes().to_vec();
        lying.extend(MAGIC);
        assert_eq!(find(&lying), None);
        // A trailer that is not at the very end does not count.
        let mut buried = with_trailer(b"red 0 0\n");
        buried.push(0);
        assert_eq!(find(&buried), None);
    }

    #[test]
    fn base64_pads() {
        for (plain, coded) in [("", ""), ("f", "Zg=="), ("fo", "Zm8="), ("foo", "Zm9v"), ("foob", "Zm9vYg=="), ("fooba", "Zm9vYmE="), ("foobar", "Zm9vYmFy")] {
            assert_eq!(base64(plain.as_bytes()), coded);
        }
        assert_eq!(base64(&[0xfb, 0xff, 0xfe]), "+//+");
    }

    #[test]
    fn page_holds_the_program_as_text() {
        assert_eq!(APP.split('§').count(), 5);
        let html = app_html("a<b", "# </pre><script> & § \nred 0 0\n");
        assert!(html.contains("<title>a&lt;b</title>"));
        assert!(html.contains("<pre id=\"src\" tabindex=\"0\"># &lt;/pre&gt;&lt;script&gt; &amp; § \nred 0 0\n</pre>"));
        assert!(html.contains(&base64(WASM)));
        // A lone CR ends no line for the CLI, so the page must not let the parser make it one.
        assert!(app_html("cr", "# a\rred 0 0\r\n").contains("># a&#13;red 0 0&#13;\n</pre>"));
    }

    #[test]
    fn a_program_can_start_with_a_shebang() {
        assert_eq!(parse("#!/usr/bin/env konfetti\nred 1000 0\n").unwrap().len(), 1);
    }
}
