use konfetti::{COLORS, Vm, compile, parse};
use std::io::{self, BufWriter, IsTerminal, LineWriter, Read, Write};
use std::process::exit;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (trace, path) = match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        [p] if !p.starts_with('-') => (false, p),
        ["--trace", p] => (true, p),
        _ => {
            eprintln!("usage: konfetti [--trace] <program.kft>\n\nInput comes from stdin, output goes to stdout.\n--trace prints every step and both stacks to stderr.");
            exit(2);
        }
    };
    let fail = |e: String| -> ! {
        eprintln!("konfetti: {path}: {e}");
        exit(1)
    };
    let src = std::fs::read_to_string(path).unwrap_or_else(|e| fail(e.to_string()));
    let bits = parse(&src).unwrap_or_else(|e| fail(e));
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
            fail(e.to_string());
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
