//! The window's look on a character grid.
//!
//! Every colour is a role converted from the window's tokens in
//! `src/css/01-base.css`, light and dark, with text colours brought to 4.5:1
//! by the rule behind `--accent-solid` (worked out in the design, see
//! `docs/tui-plan.md`). Three levels: the full colours where the terminal says
//! it has them (`COLORTERM`, Windows Terminal), the sixteen of the terminal's
//! theme elsewhere, and none at all with `NO_COLOR`, where bold, reverse and
//! underline carry the meaning. Light or dark follows the terminal's own
//! background, which it is asked for at start.
//!
//! **The background is never painted.** Only surfaces are: the header and
//! footer bands, dialogs, the selected row, fields, keycaps, search hits. The
//! terminal's own background, transparency and padding stay as the user set
//! them.

pub use crate::common::Lang;
use ratatui::style::{Color, Modifier, Style};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Colours {
    Full,
    /// The 256 of xterm: what a terminal over SSH most often says it has.
    Indexed,
    Sixteen,
    None,
}

#[derive(Clone, Copy, Debug)]
pub struct Theme {
    pub colours: Colours,
    pub light: bool,
    pub ascii: bool,
    pub lang: Lang,
}

/// One role: its value on a dark terminal, on a light one, and the nearest of
/// the sixteen.
struct Role {
    dark: u32,
    light: u32,
    sixteen: Color,
}

const TEXT: Role = Role {
    dark: 0xedeff2,
    light: 0x1a1a1e,
    sixteen: Color::Reset,
};
const MUTED: Role = Role {
    dark: 0xa3a7ae,
    light: 0x686b73,
    sixteen: Color::Gray,
};
const FAINT: Role = Role {
    dark: 0x67696e,
    light: 0xa7a9ae,
    sixteen: Color::DarkGray,
};
const SURFACE: Role = Role {
    dark: 0x27272a,
    light: 0xffffff,
    sixteen: Color::Reset,
};
const RAISED: Role = Role {
    dark: 0x333338,
    light: 0xe8eaed,
    sixteen: Color::Reset,
};
const LINE: Role = Role {
    dark: 0x38383d,
    light: 0xe6e7ea,
    sixteen: Color::DarkGray,
};
const LINE_STRONG: Role = Role {
    dark: 0x45454a,
    light: 0xcdd0d5,
    sixteen: Color::DarkGray,
};
const ACCENT: Role = Role {
    dark: 0x478bff,
    light: 0x0862ff,
    sixteen: Color::LightBlue,
};
const ACCENT_SOLID: Role = Role {
    dark: 0x0f67ff,
    light: 0x0f67ff,
    sixteen: Color::Blue,
};
const ACCENT_WASH: Role = Role {
    dark: 0x232c3f,
    light: 0xe2eaf7,
    sixteen: Color::Reset,
};
const SUCCESS: Role = Role {
    dark: 0x70bc4e,
    light: 0x3c7024,
    sixteen: Color::Green,
};
const WARNING: Role = Role {
    dark: 0xd19347,
    light: 0x986327,
    sixteen: Color::Yellow,
};
const HIGHLIGHT: Role = Role {
    dark: 0x4f3e2b,
    light: 0xe5d8ca,
    sixteen: Color::Yellow,
};
const DANGER: Role = Role {
    dark: 0xeb5847,
    light: 0xdb1f0a,
    sixteen: Color::LightRed,
};

/// The eight speaker colours of `db::COLORS`, made readable on each ground.
const SPEAKERS: [Role; 8] = [
    Role {
        dark: 0x729af2,
        light: 0x2563eb,
        sixteen: Color::LightBlue,
    },
    Role {
        dark: 0xf37643,
        light: 0xc2410c,
        sixteen: Color::LightRed,
    },
    Role {
        dark: 0x1db255,
        light: 0x15803d,
        sixteen: Color::LightGreen,
    },
    Role {
        dark: 0xaf87f4,
        light: 0x7c3aed,
        sixteen: Color::LightMagenta,
    },
    Role {
        dark: 0x09a9cf,
        light: 0x077995,
        sixteen: Color::LightCyan,
    },
    Role {
        dark: 0xf4791b,
        light: 0xb45309,
        sixteen: Color::LightYellow,
    },
    Role {
        dark: 0xf27291,
        light: 0xbe123c,
        sixteen: Color::Magenta,
    },
    Role {
        dark: 0x6bac15,
        light: 0x4d7c0f,
        sixteen: Color::Green,
    },
];

fn rgb(value: u32) -> Color {
    Color::Rgb((value >> 16) as u8, (value >> 8) as u8, value as u8)
}

/// Whether the terminal's background is light: its own answer when it gives
/// one, else `COLORFGBG` (`15;0` is light text on black), which some set.
fn background_is_light(colorfgbg: &str) -> bool {
    use terminal_colorsaurus::{theme_mode, QueryOptions, ThemeMode};
    match theme_mode(QueryOptions::default()) {
        Ok(mode) => mode == ThemeMode::Light,
        Err(_) => colorfgbg_is_light(colorfgbg),
    }
}

/// The background is the last number; 7 and 15 are the two whites.
fn colorfgbg_is_light(colorfgbg: &str) -> bool {
    matches!(
        colorfgbg.rsplit(';').next().map(str::trim),
        Some("7" | "15")
    )
}

impl Theme {
    /// What this terminal can show, and in which language.
    pub fn detect(lang: Lang) -> Theme {
        let var = |name: &str| std::env::var(name).unwrap_or_default();
        // Over SSH the terminal that draws is the one at the other end, and
        // it speaks through `TERM` (and `COLORTERM`, when the client passes
        // it on), not through Windows Terminal's own variable.
        let term = var("TERM");
        let colours = if !var("NO_COLOR").is_empty() || term == "dumb" {
            Colours::None
        } else if matches!(var("COLORTERM").as_str(), "truecolor" | "24bit")
            || !var("WT_SESSION").is_empty()
        {
            Colours::Full
        } else if term.contains("256color") {
            Colours::Indexed
        } else {
            Colours::Sixteen
        };
        // `VOLOCAL_THEME` decides when it is set. Otherwise the terminal is
        // asked for its background, which Windows Terminal answers from 1.22
        // and most terminals over SSH answer too; only where the window's own
        // colours will be painted, since the sixteen are the terminal's and
        // already suit it. No answer means dark, what terminals ship with.
        let light = match var("VOLOCAL_THEME").to_ascii_lowercase().as_str() {
            "light" => true,
            "dark" => false,
            _ => {
                matches!(colours, Colours::Full | Colours::Indexed)
                    && background_is_light(&var("COLORFGBG"))
            }
        };
        // The old console's fonts have no braille and no ✓. Windows Terminal
        // and VS Code say who they are.
        // A remote terminal says what it is with `TERM`, and any that does
        // draws braille; only the old console says nothing.
        let ascii = var("VOLOCAL_ASCII") == "1"
            || (cfg!(windows)
                && var("WT_SESSION").is_empty()
                && var("TERM_PROGRAM").is_empty()
                && term.is_empty());
        Theme {
            colours,
            light,
            ascii,
            lang,
        }
    }

    /// A value in this terminal's colours: itself, or the nearest of the 256.
    fn colour(&self, value: u32) -> Color {
        match self.colours {
            Colours::Indexed => Color::Indexed(nearest_256(value)),
            _ => rgb(value),
        }
    }

    fn fg(&self, role: &Role) -> Style {
        match self.colours {
            Colours::Full | Colours::Indexed => {
                Style::new().fg(self.colour(if self.light { role.light } else { role.dark }))
            }
            Colours::Sixteen => Style::new().fg(role.sixteen),
            Colours::None => Style::new(),
        }
    }

    fn bg(&self, role: &Role) -> Option<Color> {
        match self.colours {
            Colours::Full | Colours::Indexed => {
                Some(self.colour(if self.light { role.light } else { role.dark }))
            }
            _ => None,
        }
    }

    pub fn text(&self) -> Style {
        self.fg(&TEXT)
    }
    pub fn bold(&self) -> Style {
        self.fg(&TEXT).add_modifier(Modifier::BOLD)
    }
    pub fn muted(&self) -> Style {
        match self.colours {
            Colours::None => Style::new().add_modifier(Modifier::DIM),
            _ => self.fg(&MUTED),
        }
    }
    pub fn faint(&self) -> Style {
        match self.colours {
            Colours::None => Style::new().add_modifier(Modifier::DIM),
            _ => self.fg(&FAINT),
        }
    }
    pub fn accent(&self) -> Style {
        self.fg(&ACCENT)
    }
    pub fn success(&self) -> Style {
        self.fg(&SUCCESS)
    }
    pub fn warning(&self) -> Style {
        self.fg(&WARNING)
    }
    pub fn danger(&self) -> Style {
        self.fg(&DANGER)
    }
    pub fn rule(&self) -> Style {
        self.fg(&LINE)
    }
    pub fn border(&self) -> Style {
        self.fg(&LINE_STRONG)
    }
    pub fn track(&self) -> Style {
        self.fg(&LINE_STRONG)
    }

    /// The header and footer bands, and a dialog's body.
    pub fn band(&self) -> Style {
        match self.bg(&SURFACE) {
            Some(colour) => Style::new().bg(colour),
            None => Style::new(),
        }
    }
    pub fn dialog(&self) -> Style {
        self.band()
    }
    /// A field, and the band of the search row.
    pub fn field(&self) -> Style {
        match self.bg(&RAISED) {
            Some(colour) => Style::new().bg(colour),
            None => Style::new(),
        }
    }
    /// A key named in a footer: bold, on a raised cap.
    pub fn key(&self) -> Style {
        match self.bg(&RAISED) {
            Some(colour) => self.bold().bg(colour),
            None => Style::new().add_modifier(Modifier::BOLD | Modifier::REVERSED),
        }
    }
    /// The selected row or the focused field.
    pub fn selected(&self) -> Style {
        match self.bg(&ACCENT_WASH) {
            Some(colour) => Style::new().bg(colour),
            None => Style::new().add_modifier(Modifier::REVERSED),
        }
    }
    /// A search hit.
    pub fn hit(&self) -> Style {
        match self.colours {
            Colours::Full | Colours::Indexed => self.bold().bg(self.colour(if self.light {
                HIGHLIGHT.light
            } else {
                HIGHLIGHT.dark
            })),
            Colours::Sixteen => Style::new().fg(Color::Black).bg(Color::Yellow),
            Colours::None => Style::new().add_modifier(Modifier::UNDERLINED),
        }
    }
    /// The hit the reader is on.
    pub fn current_hit(&self) -> Style {
        match self.colours {
            Colours::Full | Colours::Indexed => Style::new()
                .fg(self.colour(if self.light { 0xf3f4f6 } else { 0x1d1d20 }))
                .bg(self.colour(if self.light {
                    WARNING.light
                } else {
                    WARNING.dark
                }))
                .add_modifier(Modifier::BOLD),
            Colours::Sixteen => Style::new()
                .fg(Color::Black)
                .bg(Color::LightYellow)
                .add_modifier(Modifier::BOLD),
            Colours::None => Style::new().add_modifier(Modifier::REVERSED | Modifier::BOLD),
        }
    }
    /// The primary button of a dialog.
    pub fn primary(&self) -> Style {
        match self.colours {
            Colours::Full | Colours::Indexed => Style::new()
                .fg(Color::White)
                .bg(self.colour(ACCENT_SOLID.dark))
                .add_modifier(Modifier::BOLD),
            Colours::Sixteen => Style::new()
                .fg(Color::White)
                .bg(ACCENT_SOLID.sixteen)
                .add_modifier(Modifier::BOLD),
            Colours::None => Style::new().add_modifier(Modifier::REVERSED | Modifier::BOLD),
        }
    }

    /// The publisher's mark: red, green and blue, the same in both themes,
    /// because a signature keeps its colours (`ZnackarnaMark` in `Brand.tsx`).
    pub fn brand(&self, which: usize) -> Style {
        const VALUES: [u32; 3] = [0xff1c26, 0x7ac942, 0x007aff];
        const SIXTEEN: [Color; 3] = [Color::LightRed, Color::LightGreen, Color::LightBlue];
        match self.colours {
            Colours::Full | Colours::Indexed => Style::new().fg(self.colour(VALUES[which % 3])),
            Colours::Sixteen => Style::new().fg(SIXTEEN[which % 3]),
            Colours::None => Style::new(),
        }
    }

    /// A speaker's name, by the colour stored with them.
    pub fn speaker(&self, hex: &str) -> Style {
        self.fg(&SPEAKERS[speaker_index(hex)])
            .add_modifier(Modifier::BOLD)
    }

    pub fn glyphs(&self) -> &'static Glyphs {
        if self.ascii {
            &ASCII
        } else {
            &UNICODE
        }
    }
}

/// The nearest of xterm's 256 to a colour: the 6 × 6 × 6 cube or the grey
/// ramp, whichever is closer. Indices 0–15 are left alone, because they are
/// the user's theme, not fixed values.
pub fn nearest_256(value: u32) -> u8 {
    let (r, g, b) = (
        (value >> 16) as i32 & 255,
        (value >> 8) as i32 & 255,
        value as i32 & 255,
    );
    let steps = [0, 95, 135, 175, 215, 255];
    let step = |c: i32| (0..6).min_by_key(|&i| (steps[i] - c).abs()).unwrap_or(0);
    let (ri, gi, bi) = (step(r), step(g), step(b));
    let cube = (steps[ri], steps[gi], steps[bi]);
    let grey_level = ((r + g + b) / 3 - 8).clamp(0, 230) / 10;
    let grey = 8 + grey_level * 10;
    let distance = |(x, y, z): (i32, i32, i32)| (x - r).pow(2) + (y - g).pow(2) + (z - b).pow(2);
    if distance((grey, grey, grey)) < distance(cube) {
        (232 + grey_level) as u8
    } else {
        (16 + 36 * ri + 6 * gi + bi) as u8
    }
}

/// The speaker's place in `db::COLORS`, from the colour stored with them; an
/// archive from before that list holds other values, and the nearest wins.
pub fn speaker_index(hex: &str) -> usize {
    let parse = |h: &str| -> Option<(i32, i32, i32)> {
        let h = h.trim_start_matches('#');
        if h.len() != 6 {
            return None;
        }
        let v = |i: usize| i32::from_str_radix(&h[i..i + 2], 16).ok();
        Some((v(0)?, v(2)?, v(4)?))
    };
    let Some((r, g, b)) = parse(hex) else {
        return 0;
    };
    volocal_lib::db::COLORS
        .iter()
        .enumerate()
        .filter_map(|(i, c)| {
            parse(c).map(|(cr, cg, cb)| (i, (cr - r).pow(2) + (cg - g).pow(2) + (cb - b).pow(2)))
        })
        .min_by_key(|(_, distance)| *distance)
        .map_or(0, |(i, _)| i)
}

pub struct Glyphs {
    pub bar: &'static str,
    pub done: &'static str,
    pub warning: &'static str,
    pub failed: &'static str,
    pub new: &'static str,
    pub active: &'static str,
    pub radio_on: &'static str,
    pub radio_off: &'static str,
    pub checked: &'static str,
    pub unchecked: &'static str,
    pub crumb: &'static str,
    pub dropdown: &'static str,
    pub left: &'static str,
    pub right: &'static str,
    pub fill: &'static str,
    pub tip: &'static str,
    pub track: &'static str,
    pub cursor: &'static str,
    pub rule: &'static str,
    pub dot: &'static str,
    pub ellipsis: &'static str,
    pub enter: &'static str,
    pub updown: &'static str,
    /// The inline mill, four cells, one frame per 100 ms.
    pub mill: &'static [&'static str],
    /// Whether the braille mark may be drawn at all.
    pub braille: bool,
}

const UNICODE: Glyphs = Glyphs {
    bar: "▌",
    done: "✓",
    warning: "!",
    failed: "✕",
    new: "·",
    active: "●",
    radio_on: "●",
    radio_off: "○",
    checked: "■",
    unchecked: "□",
    crumb: " › ",
    dropdown: "▾",
    left: "‹",
    right: "›",
    fill: "━",
    tip: "╸",
    track: "─",
    cursor: "▏",
    rule: "│",
    dot: "●",
    ellipsis: "…",
    enter: "↵",
    updown: "↑↓",
    mill: &[
        " ⢈⡁ ",
        "⠆⢈⡁ ",
        "⠶⢈⡁ ",
        "⠶⢎⡁ ",
        "⠰⢾⡁ ",
        " ⢾⡇ ",
        " ⢸⡷ ",
        " ⢈⡷⠆",
        " ⢈⡱⠶",
        " ⢈⡁⠶",
        " ⢈⡁⠰",
    ],
    braille: true,
};

const ASCII: Glyphs = Glyphs {
    bar: ">",
    done: "+",
    warning: "!",
    failed: "x",
    new: ".",
    active: "*",
    radio_on: "(*)",
    radio_off: "( )",
    checked: "[x]",
    unchecked: "[ ]",
    crumb: " > ",
    dropdown: "v",
    left: "<",
    right: ">",
    fill: "=",
    tip: ">",
    track: "-",
    cursor: "_",
    rule: "|",
    dot: "*",
    ellipsis: "...",
    enter: "Enter",
    updown: "Up/Dn",
    mill: &[" |  ", " /  ", " -  ", " \\  "],
    braille: false,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speakers_keep_their_place_in_the_window_colours() {
        assert_eq!(speaker_index("#c2410c"), 1);
        assert_eq!(speaker_index("#1f6feb"), 0);
        assert_eq!(speaker_index("rubbish"), 0);
    }

    #[test]
    fn colorfgbg_says_light_only_for_a_white_background() {
        assert!(colorfgbg_is_light("0;15"));
        assert!(colorfgbg_is_light("0;default;7"));
        assert!(!colorfgbg_is_light("15;0"));
        assert!(!colorfgbg_is_light(""));
    }

    #[test]
    fn colours_find_their_place_among_the_256() {
        assert_eq!(nearest_256(0xffffff), 231);
        assert_eq!(nearest_256(0x000000), 16);
        // The dark ground is a grey, not the cube's black.
        assert!((232..=255).contains(&nearest_256(0x27272a)));
        assert_eq!(nearest_256(0x0f67ff), 27);
    }

    #[test]
    fn every_mill_frame_is_four_cells() {
        for frame in UNICODE.mill.iter().chain(ASCII.mill) {
            assert_eq!(frame.chars().count(), 4);
        }
    }
}
