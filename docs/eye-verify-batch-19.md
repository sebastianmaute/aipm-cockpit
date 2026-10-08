# Eye-verify checklist, batch 19: §219 images in Office and PDF

§219 (#194) owes the image half of the Office check: batch 17 checked the samples' links, not their
pictures. This kit writes one sample per remaining item. The entry closes on your sign-off; tick
what you saw, and note anything that looks wrong beside its line.

```bash
npx jiti scripts/sample-image-exports.ts eye-verify-output/batch-19/office
```

It writes 15 files to `eye-verify-output/batch-19/office/` (git-ignored) and refuses any that fails
its byte-level checks. Every image carries a big label and, on most, its pixel size, so you can
tell the images apart and judge order and size by eye. The images go through the same per-format
rule a real download uses: HTML and PDF are capped at 25 MB of images, Word and PowerPoint are not.

**Which reader:** `.docx` in **Word**, `.pptx` in **PowerPoint**, `.html` in a **browser**. Where a
line also names LibreOffice or Pages, open it there too if you have it, and say which readers you
used.

## Items 1–3: two images in a long document

- [ ] `1-two-images.docx` in **Word**, and in **LibreOffice Writer** if you have it: "Image A"
  (wide, 1200 × 600) comes first, then "Image B" (tall, 600 × 900). Both draw, neither is
  stretched or cropped, and the paragraphs before, between and after them are all there.
- [ ] `1-two-images.pptx` in **PowerPoint**: each picture sits inside its slide's body area, nothing
  overlaps the text, and the long text after Image B runs onto further slides rather than off the
  bottom of one.
- [ ] `1-two-images.html` in a **browser**, then print it to PDF (Ctrl+P → Save as PDF): both
  images are in the PDF. That is the app's PDF path; the app only adds an automatic print.

## Item 4: images over the export budget

`4-over-budget.*` holds six 4.7 MB images, "Big 1" to "Big 6", about 28 MB in all.

- [ ] `4-over-budget.html` in a **browser** (about 31 MB, as the script reports it): Big 1 to Big 5 draw, and where
  Big 6 would be there is the text "[Image: big-6.png]". Print it to PDF: the PDF shows the same.
- [ ] `4-over-budget.docx` in **Word** and `4-over-budget.pptx` in **PowerPoint**: all six draw,
  with no placeholder. Word and PowerPoint have no budget.

## Item 5: an image whose stored bytes are missing

`5-dangling.*` has a "Present" image and a second image whose bytes are gone (its own pixels say
"SHOULD NOT DRAW", so if it ever appears, that is the defect).

- [ ] In all three (`.html` in a browser, `.docx` in Word, `.pptx` in PowerPoint): "Present"
  draws, and where the second image would be there is a visible marker, not a silent gap. In Word
  and PowerPoint that is the text "[Image: gone.png]"; the HTML shows a box with a dashed border, holding the image's alt text, "Gone".

## Item 6: WebP

- [ ] `6-webp.docx` and `6-webp.pptx`: the "WebP image" picture draws. ★ The useful reader is an
  OLDER Word: 2016, 2019 or 2021 perpetual, or a non-subscription Mac Office. Note which build
  you used and what it drew. If you only have current Microsoft 365, say so: it is expected to
  draw it, so that result does not close this item by itself.

## Item 7: deck length

Since §222 (2026-10-02) a picture is scaled down onto the current slide when at least half the slide
is still free, and otherwise starts the next slide. Two samples sit clear of that line.

- [ ] `7a-deck-short-lead.pptx` in **PowerPoint**: one line of text, then the "Screenshot" picture
  scaled onto the SAME slide below it, readable and not overlapping the text. One content slide.
- [ ] `7b-deck-long-lead.pptx` in **PowerPoint**: a long paragraph fills most of the first slide,
  and the "Screenshot" picture starts the NEXT slide, at full slide size.
- [ ] Either way: say whether the layout reads well.

## Item 8: one image used four times

`8-reused-image.*` uses one stored image four times: twice on its own, then twice in one
paragraph. The file holds that image ONCE.

- [ ] `8-reused-image.docx` in **Word**, and in **LibreOffice** and **Pages** if you have them: all
  four "Reused" pictures draw.
- [ ] `8-reused-image.pptx` in **PowerPoint**: all four draw. Note how they land on the slides
  (each alone, or two on one slide).
