# Narration files (English)

Each video has one text file here, named after the video, for example `ch3-monday.md`.
The words in it are what the narrator says. The recorder reads these files; nothing else needs editing.

## How a file looks

```
# Monday - a milestone slipped

## title
Monday. The MVP target passed on Friday, and nothing moved it.

## mon-hero
Before you open a single list, the dashboard puts one thing on top.
```

- A line starting with `## ` begins a new spoken part. The word after it is its name.
- Everything under that line, up to the next `## ` line, is spoken. Line breaks do not matter.
- The text above the first `## ` line is only a title for you. It is not spoken.
- A name uses small letters, digits and dashes only, for example `mon-hero`. No spaces or capitals.
- Every name must be used once per file, and every part needs some text.

## Three special names

- `title`: spoken while the title card is shown.
- `opening`: spoken with the opening caption.
- `closing`: shown as the last caption and spoken over the closing frame; it stays on screen to the end.

## The big video

`big.md` adds to the six chapter files. If it has a part with the same name as a chapter part, the
`big.md` text is used instead for the big video.
`ch1-install` (played back from a recording made by hand) is not part of the big video.
