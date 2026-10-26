import { describe, expect, it } from "vitest";
import { HELP_ENTRIES } from "./help-content";
import { FORECAST_SIM_HELP_ID } from "./sim-explainer";
import {
  HELP_ENTRY_VIDEOS,
  HELP_VIDEO_CATALOGUE,
  YOUTUBE_CHANNEL_URL,
  helpEntryVideos,
  youtubeWatchUrl,
} from "./help-videos";

describe("help videos", () => {
  const catalogue = Object.values(HELP_VIDEO_CATALOGUE);

  it("gives every video a well-formed, distinct YouTube id and a distinct title", () => {
    for (const v of catalogue) expect(v.youtubeId).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(new Set(catalogue.map((v) => v.youtubeId)).size).toBe(catalogue.length);
    expect(new Set(catalogue.map((v) => v.title)).size).toBe(catalogue.length);
  });

  it("links videos only from entries that exist and are not withheld", () => {
    const ids = new Set(HELP_ENTRIES.map((e) => e.id));
    const mapped = Object.keys(HELP_ENTRY_VIDEOS);
    expect(mapped.length).toBeGreaterThan(0);
    for (const id of mapped) expect(ids.has(id)).toBe(true);
    // The simulation entry is hidden while the forecast is held back; a link on it would be dead weight.
    expect(mapped).not.toContain(FORECAST_SIM_HELP_ID);
  });

  it("lists no video twice on one entry", () => {
    for (const list of Object.values(HELP_ENTRY_VIDEOS)) expect(new Set(list).size).toBe(list!.length);
  });

  it("returns an entry's videos in order, and none for an entry without any", () => {
    expect(helpEntryVideos("feature-inline-ai-edit").map((v) => v.title)).toEqual([
      "Ask Claude on a task",
      "Ask Claude on RAID, changes, milestones and stakeholders",
    ]);
    expect(helpEntryVideos("feature-keys")).toEqual([]);
    expect(helpEntryVideos("no-such-entry")).toEqual([]);
  });

  it("builds YouTube watch and channel URLs", () => {
    expect(youtubeWatchUrl(HELP_VIDEO_CATALOGUE["f-gantt"])).toBe("https://www.youtube.com/watch?v=tCCn6MzgmlQ");
    expect(YOUTUBE_CHANNEL_URL).toBe("https://www.youtube.com/@aipmcockpit");
  });
});
