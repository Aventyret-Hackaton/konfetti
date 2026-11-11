//! konfetti core: parse, link, compile, run. The language is defined in SPEC.md.

use std::cmp::Ordering;
use std::io::{self, Read, Write};

/// Palette, in opcode order.
pub const COLORS: [&str; 13] = [
    "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "white", "black",
    "brown", "silver", "gold",
];
const RED: u8 = 0;
const ORANGE: u8 = 1;
const YELLOW: u8 = 2;
const GREEN: u8 = 3;
const CYAN: u8 = 4;
const BLUE: u8 = 5;
const PURPLE: u8 = 6;
const PINK: u8 = 7;
const WHITE: u8 = 8;
const BLACK: u8 = 9;
const BROWN: u8 = 10;
const SILVER: u8 = 11;
const GOLD: u8 = 12;
/// A red bit reached from a red bit: add to the top instead of pushing.
const INC: u8 = 13;

/// Bits at most this far apart are linked.
pub const REACH: i64 = 1500;
/// A bit closer than this to a later-listed bit lies under it, covered.
pub const MIN_GAP: i64 = 500;
/// Coordinate bound. Keeps every squared distance inside an i64.
pub const MAX_COORD: i64 = 1_000_000_000;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bit {
    pub color: u8,
    pub x: i64,
    pub y: i64,
}

pub fn parse(src: &str) -> Result<Vec<Bit>, String> {
    let mut bits = Vec::new();
    for (n, line) in src.lines().enumerate() {
        let line = line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let err = |m: String| format!("line {}: {}", n + 1, m);
        let mut f = line.split_whitespace();
        let (Some(c), Some(x), Some(y), None) = (f.next(), f.next(), f.next(), f.next()) else {
            return Err(err("expected `color x y`".into()));
        };
        let color = COLORS
            .iter()
            .position(|&k| k == c)
            .ok_or_else(|| err(format!("unknown color `{c}`")))? as u8;
        let coord = |s: &str| {
            s.parse::<i64>()
                .ok()
                .filter(|v| v.abs() <= MAX_COORD)
                .ok_or_else(|| err(format!("bad coordinate `{s}` (integer within ±{MAX_COORD})")))
        };
        bits.push(Bit { color, x: coord(x)?, y: coord(y)? });
    }
    Ok(bits)
}

#[derive(Clone, Copy)]
struct Ins {
    op: u8,
    /// Index of the bit this instruction sits on, for debuggers.
    bit: u32,
    imm: i64,
    /// Successor going straightest; also the only successor of a non-branch.
    next: u32,
    left: u32,
    right: u32,
}

const HALT: u32 = u32::MAX;

/// A scatter compiled to a control flow graph. One instruction per
/// `(prev, cur)` pair, so no geometry is left for the run loop to look at.
pub struct Program {
    ins: Vec<Ins>,
    start: u32,
}

/// Orders turns, given as `(cross, dot)` against the heading, by signed angle
/// in (-180°, 180°]. Exact: integers only.
fn cmp_turn(a: (i64, i64), b: (i64, i64)) -> Ordering {
    let half = |(cross, dot): (i64, i64)| match (cross.cmp(&0), dot > 0) {
        (Ordering::Less, _) => 0,
        (Ordering::Equal, true) => 1,
        (Ordering::Greater, _) => 2,
        (Ordering::Equal, false) => 3,
    };
    half(a).cmp(&half(b)).then_with(|| {
        // Same half plane: b is the larger angle when it is counter-clockwise of a.
        let ccw = a.1 as i128 * b.0 as i128 - a.0 as i128 * b.1 as i128;
        0.cmp(&ccw)
    })
}

/// `fold` merges runs of red into one instruction. Same results, fewer steps;
/// turn it off to step bit by bit.
pub fn compile(bits: &[Bit], fold: bool) -> Program {
    let n = bits.len();
    if n == 0 {
        return Program { ins: Vec::new(), start: HALT };
    }
    let d2 = |a: Bit, b: Bit| (a.x - b.x).pow(2) + (a.y - b.y).pow(2);

    // ponytail: all-pairs linking is O(n²). Bucket bits into a REACH-sized
    // grid when programs reach tens of thousands of bits.
    // File order is stacking order. A covered bit takes no part in the program.
    let covered: Vec<bool> =
        (0..n).map(|i| (i + 1..n).any(|j| d2(bits[i], bits[j]) < MIN_GAP * MIN_GAP)).collect();
    let mut adj: Vec<Vec<u32>> = vec![Vec::new(); n];
    for i in 0..n {
        for j in i + 1..n {
            if !covered[i] && !covered[j] && d2(bits[i], bits[j]) <= REACH * REACH {
                adj[i].push(j as u32);
                adj[j].push(i as u32);
            }
        }
    }

    // State (prev, cur) lives at off[cur] + position of prev in adj[cur].
    let mut off = vec![0u32; n + 1];
    for i in 0..n {
        off[i + 1] = off[i] + adj[i].len() as u32;
    }
    let state = |prev: u32, cur: u32| {
        off[cur as usize] + adj[cur as usize].iter().position(|&q| q == prev).unwrap() as u32
    };

    // Successors of `cur` when arriving with `heading`: (straight, left, right).
    let successors = |cur: u32, prev: Option<u32>, heading: (i64, i64)| {
        let here = bits[cur as usize];
        let cands: Vec<(u32, (i64, i64), i64)> = adj[cur as usize]
            .iter()
            .filter(|&&q| Some(q) != prev)
            .map(|&q| {
                let v = (bits[q as usize].x - here.x, bits[q as usize].y - here.y);
                let turn = (heading.0 * v.1 - heading.1 * v.0, heading.0 * v.0 + heading.1 * v.1);
                (q, turn, v.0 * v.0 + v.1 * v.1)
            })
            .collect();
        // Ties go to the nearer bit, then the one listed first.
        let tie = |a: &(u32, (i64, i64), i64), b: &(u32, (i64, i64), i64)| (a.2, a.0).cmp(&(b.2, b.0));
        let abs = |t: (i64, i64)| (t.0.abs(), t.1);
        let to_state = |c: Option<&(u32, (i64, i64), i64)>| c.map_or(HALT, |c| state(cur, c.0));
        (
            to_state(cands.iter().min_by(|a, b| cmp_turn(abs(a.1), abs(b.1)).then_with(|| tie(a, b)))),
            to_state(cands.iter().min_by(|a, b| cmp_turn(b.1, a.1).then_with(|| tie(a, b)))),
            to_state(cands.iter().min_by(|a, b| cmp_turn(a.1, b.1).then_with(|| tie(a, b)))),
        )
    };

    let mut ins = Vec::with_capacity(off[n] as usize + 1);
    for cur in 0..n as u32 {
        let c = bits[cur as usize];
        for &prev in &adj[cur as usize] {
            let p = bits[prev as usize];
            let (next, left, right) = successors(cur, Some(prev), (c.x - p.x, c.y - p.y));
            let op = if c.color == RED && p.color == RED { INC } else { c.color };
            ins.push(Ins { op, bit: cur, imm: 1, next, left, right });
        }
    }

    // Start: the bit nearest the origin, heading away from it. The last bit is
    // never covered, so there is always one.
    let first = (0..n).filter(|&i| !covered[i]).min_by_key(|&i| bits[i].x.pow(2) + bits[i].y.pow(2)).unwrap();
    let f = bits[first];
    let heading = if (f.x, f.y) == (0, 0) { (1, 0) } else { (f.x, f.y) };
    let (next, left, right) = successors(first as u32, None, heading);
    let start = ins.len() as u32;
    ins.push(Ins { op: f.color, bit: first as u32, imm: 1, next, left, right });

    if fold {
        let unfolded = ins.clone();
        for i in ins.iter_mut().filter(|i| i.op == RED || i.op == INC) {
            // The length cap only matters for an all-red ring, which never ends.
            while i.next != HALT && unfolded[i.next as usize].op == INC && i.imm < unfolded.len() as i64 {
                i.imm += 1;
                i.next = unfolded[i.next as usize].next;
            }
        }
    }
    Program { ins, start }
}

pub struct Vm {
    prog: Program,
    pc: u32,
    pub main: Vec<i64>,
    pub stash: Vec<i64>,
}

impl Vm {
    pub fn new(prog: Program) -> Self {
        let pc = prog.start;
        Vm { prog, pc, main: Vec::new(), stash: Vec::new() }
    }

    /// Index of the bit about to execute, or None once halted.
    pub fn cur(&self) -> Option<u32> {
        self.prog.ins.get(self.pc as usize).map(|i| i.bit)
    }

    /// Runs at most `steps` instructions. Ok(true) means the program halted.
    pub fn run(&mut self, mut steps: u64, inp: &mut impl Read, out: &mut impl Write) -> io::Result<bool> {
        let ins = &self.prog.ins[..];
        let main = &mut self.main;
        let mut pc = self.pc;
        let result = loop {
            if pc == HALT {
                break Ok(true);
            }
            if steps == 0 {
                break Ok(false);
            }
            steps -= 1;
            let i = &ins[pc as usize];
            pc = i.next;
            // Too few operands: the instruction does nothing.
            match i.op {
                RED => main.push(i.imm),
                INC => {
                    if let Some(t) = main.last_mut() {
                        *t = t.wrapping_add(i.imm)
                    }
                }
                ORANGE => {
                    if let Some(&t) = main.last() {
                        main.push(t)
                    }
                }
                YELLOW => {
                    let l = main.len();
                    if l >= 2 {
                        main.swap(l - 1, l - 2)
                    }
                }
                GREEN => binop(main, i64::wrapping_add),
                CYAN => binop(main, i64::wrapping_sub),
                BLUE => binop(main, i64::wrapping_mul),
                PURPLE => {
                    let l = main.len();
                    if l >= 2 && main[l - 1] != 0 {
                        let (a, b) = (main[l - 2], main[l - 1]);
                        // Floored: the remainder takes the sign of the divisor.
                        let (mut q, mut r) = (a.wrapping_div(b), a.wrapping_rem(b));
                        if r != 0 && (r < 0) != (b < 0) {
                            q -= 1;
                            r += b;
                        }
                        main[l - 2] = q;
                        main[l - 1] = r;
                    }
                }
                PINK => match main.pop() {
                    Some(a) if a > 0 => pc = i.left,
                    Some(a) if a < 0 => pc = i.right,
                    _ => {}
                },
                WHITE => {
                    if let Some(a) = main.pop() {
                        if let Err(e) = out.write_all(&[a as u8]) {
                            break Err(e);
                        }
                    }
                }
                BLACK => {
                    let mut b = [0u8];
                    match inp.read(&mut b) {
                        Ok(1) => main.push(b[0] as i64),
                        Ok(_) => main.push(-1),
                        Err(e) => break Err(e),
                    }
                }
                BROWN => {
                    main.pop();
                }
                SILVER => {
                    if let Some(a) = main.pop() {
                        self.stash.push(a)
                    }
                }
                GOLD => {
                    if let Some(a) = self.stash.pop() {
                        main.push(a)
                    }
                }
                _ => unreachable!(),
            }
        };
        self.pc = pc;
        result
    }
}

#[inline(always)]
fn binop(main: &mut Vec<i64>, f: fn(i64, i64) -> i64) {
    let l = main.len();
    if l >= 2 {
        let b = main.pop().unwrap();
        main[l - 2] = f(main[l - 2], b);
    }
}

/// Raw C ABI for the web editor; web/main.js is the only caller.
#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use std::sync::Mutex;

    struct Session {
        buf: Vec<u8>,
        vm: Option<Vm>,
        input: Vec<u8>,
        inpos: usize,
        out: Vec<u8>,
    }
    static S: Mutex<Session> =
        Mutex::new(Session { buf: Vec::new(), vm: None, input: Vec::new(), inpos: 0, out: Vec::new() });

    /// Scratch buffer the page writes into before `kf_load`.
    #[unsafe(no_mangle)]
    pub extern "C" fn kf_buf(len: usize) -> *mut u8 {
        let mut s = S.lock().unwrap();
        s.buf.resize(len, 0);
        s.buf.as_mut_ptr()
    }

    /// The buffer holds the .kft source (`src_len` bytes) followed by the
    /// program's input. Returns 0, or 1 with the error text as the output.
    #[unsafe(no_mangle)]
    pub extern "C" fn kf_load(src_len: usize, fold: i32) -> i32 {
        let mut s = S.lock().unwrap();
        let s = &mut *s;
        let src_len = src_len.min(s.buf.len());
        s.input = s.buf[src_len..].to_vec();
        s.inpos = 0;
        s.out.clear();
        let prog = std::str::from_utf8(&s.buf[..src_len])
            .map_err(|e| e.to_string())
            .and_then(parse)
            .map(|bits| compile(&bits, fold != 0));
        match prog {
            Ok(p) => {
                s.vm = Some(Vm::new(p));
                0
            }
            Err(e) => {
                s.vm = None;
                s.out = e.into_bytes();
                1
            }
        }
    }

    /// Runs up to `steps` instructions. Returns 1 once halted.
    #[unsafe(no_mangle)]
    pub extern "C" fn kf_run(steps: u32) -> i32 {
        let mut s = S.lock().unwrap();
        let s = &mut *s;
        let Some(vm) = s.vm.as_mut() else { return 1 };
        let mut inp = &s.input[s.inpos..];
        let halted = vm.run(steps as u64, &mut inp, &mut s.out).unwrap_or(true);
        s.inpos = s.input.len() - inp.len();
        halted as i32
    }

    /// Index of the bit about to execute, -1 once halted.
    #[unsafe(no_mangle)]
    pub extern "C" fn kf_cur() -> i32 {
        S.lock().unwrap().vm.as_ref().and_then(Vm::cur).map_or(-1, |b| b as i32)
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn kf_out() -> *const u8 {
        S.lock().unwrap().out.as_ptr()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn kf_out_len() -> usize {
        S.lock().unwrap().out.len()
    }

    /// `which`: 0 = main, 1 = stash. Pointer to i64 cells, bottom first.
    #[unsafe(no_mangle)]
    pub extern "C" fn kf_stack(which: i32) -> *const i64 {
        let s = S.lock().unwrap();
        s.vm.as_ref().map_or(std::ptr::null(), |vm| if which == 0 { vm.main.as_ptr() } else { vm.stash.as_ptr() })
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn kf_stack_len(which: i32) -> usize {
        let s = S.lock().unwrap();
        s.vm.as_ref().map_or(0, |vm| if which == 0 { vm.main.len() } else { vm.stash.len() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_bits(bits: &[Bit], input: &[u8], fold: bool) -> Vec<u8> {
        let mut vm = Vm::new(compile(bits, fold));
        let (mut inp, mut out) = (input, Vec::new());
        assert!(vm.run(1_000_000, &mut inp, &mut out).unwrap(), "did not halt");
        out
    }

    /// Runs both folded and unfolded and insists they agree.
    fn run(src: &str, input: &[u8]) -> Vec<u8> {
        let bits = parse(src).unwrap();
        let out = run_bits(&bits, input, true);
        assert_eq!(out, run_bits(&bits, input, false), "fold changed the result");
        out
    }

    /// One letter per bit, laid out east from the origin. Spaces are ignored.
    fn line(ops: &str) -> Vec<Bit> {
        ops.chars()
            .filter(|c| !c.is_whitespace())
            .enumerate()
            .map(|(i, c)| Bit { color: "royGcbpPwkBsg".find(c).unwrap() as u8, x: 1200 * (i as i64 + 1), y: 0 })
            .collect()
    }

    fn run_line(ops: &str, input: &[u8]) -> Vec<u8> {
        let bits = line(ops);
        let out = run_bits(&bits, input, true);
        assert_eq!(out, run_bits(&bits, input, false), "fold changed the result");
        out
    }

    #[test]
    fn hello() {
        assert_eq!(run(include_str!("../examples/hello.kft"), b""), b"A");
    }

    #[test]
    fn cat_loops_until_end_of_input() {
        assert_eq!(run(include_str!("../examples/cat.kft"), b"konfetti\n"), b"konfetti\n");
        assert_eq!(run(include_str!("../examples/cat.kft"), b""), b"");
    }

    #[test]
    fn arithmetic() {
        // 1 - 8 = -7; -7 divmod 2 = -4 rem 1 (floored). Prints rem then quotient.
        assert_eq!(run_line("r o rrrrrrr G c rr p w w", b""), [1, 252]);
        // Division by zero does nothing: 3 and 0 stay.
        assert_eq!(run_line("rrr o o c p w w", b""), [0, 3]);
        // swap: 1 2 -> 2 1
        assert_eq!(run_line("r o r G y w w", b""), [1, 2]);
        // stash and fetch: 2, stash it, 3, fetch -> 3 2
        assert_eq!(run_line("rr s rrr g w w", b""), [2, 3]);
        // input, and -1 at the end of it
        assert_eq!(run_line("k w k w", b"x"), [b'x', 255]);
    }

    #[test]
    fn too_few_operands_is_a_no_op() {
        assert_eq!(run_line("o y G c b p P w B g s rr w", b""), [2]);
    }

    #[test]
    fn branch_three_ways() {
        // Heading east into pink, with stubs printing 1 (north), 2 (east), 3 (south).
        for (sign, want) in [("r", 1), ("r o c", 2), ("r o r G c", 3)] {
            let mut bits = line(&format!("{sign} P"));
            let (px, red, white) = (bits.last().unwrap().x, 0, 8);
            let stub = |dx: i64, dy: i64, n: i64| {
                (1..=n + 1).map(move |k| Bit { color: if k <= n { red } else { white }, x: px + dx * k, y: dy * k })
            };
            bits.extend(stub(0, 1200, 1).chain(stub(1200, 0, 2)).chain(stub(0, -1200, 3)));
            assert_eq!(run_bits(&bits, b"", true), [want], "sign program `{sign}`");
            assert_eq!(run_bits(&bits, b"", false), [want], "sign program `{sign}` unfolded");
        }
    }

    #[test]
    fn a_later_bit_covers_the_one_under_it() {
        // The white at 2400 lies under a brown, so nothing is printed there;
        // the walk steps over it to the red and white beyond.
        let src = "red 1200 0\nwhite 2400 0\nbrown 2500 100\nred 3700 0\nwhite 4900 0\n";
        assert_eq!(run(src, b""), [1]);
        // A covered bit cannot be the start either, however near the origin.
        assert_eq!(run("red 100 0\nwhite 200 0\n", b""), []);
    }

    #[test]
    fn load_errors() {
        assert!(parse("teal 0 0").unwrap_err().contains("line 1"));
        assert!(parse("red 0").is_err());
        assert!(parse("red 0 2000000000").is_err());
        assert!(run("# nothing\n", b"").is_empty());
    }

    #[test]
    fn turns_are_ordered_by_signed_angle() {
        // (cross, dot) for -135°, -45°, 0°, 45°, 135°, 180°
        let turns = [(-1, -1), (-1, 1), (0, 1), (1, 1), (1, -1), (0, -1)];
        for (i, a) in turns.iter().enumerate() {
            for (j, b) in turns.iter().enumerate() {
                assert_eq!(cmp_turn(*a, *b), i.cmp(&j), "{a:?} vs {b:?}");
            }
        }
    }
}
