// src/app/settings-sections/ai-usage-panel.test.tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { AI_FEATURE_LABEL } from "../ai-usage-paths";
import { AiUsagePanel } from "./ai-usage-panel";
import {
  AI_CAP_BASIS_NOTICE_KEY,
  AI_COST_BASIS_NOTICE_KEY,
  AiUsageProvider,
  useAiUsageContext,
} from "../ai-usage-context";
import { AI_USAGE_KEY } from "../ai-usage-store";
import { emitUsage } from "../../test/usage-tap";
import { defaultAiConfig } from "../settings-types";
import { t, loadI18n, localeFor, type Lang } from "../i18n";
import { nextWeekReset, type Usage } from "../ai-usage";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP } from "../settings-types";

// The provider records what the transport's tap reports, so the tests drive that tap directly.
vi.mock("../ai-transport", async (orig) => ({
  ...(await orig<typeof import("../ai-transport")>()),
  subscribeAiUsage: (await import("../../test/usage-tap")).fakeSubscribeAiUsage,
}));

// AiUsagePanel reads from AiUsageContext via useAiUsageContext().
// Wrap with the real AiUsageProvider seeded with zero usage (clean localStorage).
function wrapper({ children }: { children: ReactNode }) {
  return (
    <AiUsageProvider lang="en-US" ai={defaultAiConfig} showToast={vi.fn()}>
      {children}
    </AiUsageProvider>
  );
}

// Taps ONE Usage sample on mount (a ref guard keeps it firing once even under
// StrictMode's double-invoke). It sits OUTSIDE the provider: effects run child
// first, so only a parent's effect runs after the provider has subscribed.
function Seed({ usage, children }: { usage: Usage; children: ReactNode }) {
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    emitUsage("chat", usage);
  }, [usage]);
  return <>{children}</>;
}

// No scaling to defeat any more: the provider stores raw counts, so the
// seeded Usage lands in sessionUsage unchanged.
function seededWrapper(lang: Lang, usage: Usage) {
  const ai = { ...defaultAiConfig };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <Seed usage={usage}>
        <AiUsageProvider lang={lang} ai={ai} showToast={vi.fn()}>
          {children}
        </AiUsageProvider>
      </Seed>
    );
  };
}

const CACHE_USAGE: Usage = { input: 1000, output: 100, cacheWrite: 500, cacheRead: 9000 };

// ★★ A cost-equivalent total is FRACTIONAL for almost any real turn, and every
//    other fixture in this file happens to land on a whole number (3,025 and
//    275) — which is exactly why the raw render went unnoticed. Weights are
//    input 1 · cacheWrite 1.25 · cacheRead 0.1 · output 5, so this prices at
//    20000 + 3.75 + 1.1 + 5 = 20009.85 EXACTLY (no float residue: verified by
//    the assertions below, which pin both the rounded and the unrounded form).
const FRACTIONAL_USAGE: Usage = { input: 20_000, output: 1, cacheWrite: 3, cacheRead: 11 };

// An upgrading device: a usage blob EXISTS (so AiUsageProvider's fresh-install
// branch does not seed the flags away) and neither notice flag is set.
function seedUpgradingDevice(): void {
  localStorage.setItem(
    AI_USAGE_KEY,
    JSON.stringify({ "2000-01-01": { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 } }),
  );
}

beforeEach(() => {
  // The flags live in localStorage, which jsdom keeps for the whole FILE —
  // without this, whichever test ran first would decide every later one.
  localStorage.clear();
});

describe("AiUsagePanel — per-feature breakdown", () => {
  const input = (n: number): Usage => ({ input: n, output: 0, cacheWrite: 0, cacheRead: 0 });

  it("renders one row per feature with its label, the background line and the coverage label", () => {
    render(<AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />, { wrapper });
    act(() => {
      emitUsage("chat", input(300));
      emitUsage("propose_wbs_changes:background", input(200));
    });
    expect(screen.getByText(t("en-US", AI_FEATURE_LABEL.chat))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", AI_FEATURE_LABEL.wbs))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", AI_FEATURE_LABEL.digest))).toBeNull();
    expect(screen.getByText(t("en-US", "aiUsageBackgroundWeek"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "aiUsageCoversAllFeatures"))).toBeInTheDocument();
  });

  // A `dl` has no role, so an `aria-label` on it may be ignored or flagged (axe never renders this panel: the e2e
  // seed has no usage). The breakdown is a named group whose name is its visible caption.
  // Mutation: restoring `<dl aria-label>` without the group turns this red.
  it("names the breakdown by a visible caption, as a group", () => {
    const { container } = render(<AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />, { wrapper });
    act(() => { emitUsage("chat", input(300)); });
    const group = screen.getByRole("group", { name: t("en-US", "aiUsageByFeature") });
    expect(group).toContainElement(screen.getByText(t("en-US", AI_FEATURE_LABEL.chat)));
    expect(screen.getByText(t("en-US", "aiUsageByFeature"))).toBeVisible();
    expect(container.querySelector("dl[aria-label]")).toBeNull();
  });

  it("shows no breakdown before any usage", () => {
    render(<AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />, { wrapper });
    expect(screen.queryByText(t("en-US", AI_FEATURE_LABEL.chat))).toBeNull();
    expect(screen.queryByText(t("en-US", "aiUsageBackgroundWeek"))).toBeNull();
  });
});

describe("AiUsagePanel", () => {
  it("renders session and weekly usage bar labels", () => {
    render(
      <AiUsagePanel
        lang="en-US"
        sessionCap={DEFAULT_SESSION_TOKEN_CAP}
        weeklyCap={DEFAULT_WEEKLY_TOKEN_CAP}
      />,
      { wrapper },
    );
    expect(screen.getByText(t("en-US", "aiUsageSession"))).toBeTruthy();
    expect(screen.getByText(t("en-US", "aiUsageWeek"))).toBeTruthy();
  });

  it("progressbar aria-valuemax reflects sessionCap prop", () => {
    render(
      <AiUsagePanel
        lang="en-US"
        sessionCap={10_000}
        weeklyCap={DEFAULT_WEEKLY_TOKEN_CAP}
      />,
      { wrapper },
    );
    // The aria-valuemax attribute is always a raw integer — locale-independent.
    const bars = screen.getAllByRole("progressbar");
    const maxValues = bars.map((b) => Number(b.getAttribute("aria-valuemax")));
    expect(maxValues).toContain(10_000);
  });

  it("renders two progressbar roles — one per usage scope", () => {
    render(
      <AiUsagePanel
        lang="en-US"
        sessionCap={DEFAULT_SESSION_TOKEN_CAP}
        weeklyCap={DEFAULT_WEEKLY_TOKEN_CAP}
      />,
      { wrapper },
    );
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(2);
  });

  it("progressbar aria-valuemax reflects the passed cap props", () => {
    render(
      <AiUsagePanel
        lang="en-US"
        sessionCap={5_000}
        weeklyCap={50_000}
      />,
      { wrapper },
    );
    const bars = screen.getAllByRole("progressbar");
    const maxValues = bars.map((b) => Number(b.getAttribute("aria-valuemax")));
    expect(maxValues).toContain(5_000);
    expect(maxValues).toContain(50_000);
  });

  it("shows the session cache breakdown and hit rate", () => {
    render(
      <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
      { wrapper: seededWrapper("en-US", CACHE_USAGE) },
    );
    // ★ The panel formats every figure via `.toLocaleString(localeFor(lang))`
    //   (explicit locale, not the runtime default) so the grouping separator
    //   is pinned to what "en-US" always produces, regardless of the host
    //   machine's own ICU default locale — verified this repo's dev machine
    //   resolves Intl's UNQUALIFIED default to "de-DE" ("9.000", dot
    //   grouping), which would silently break a bare `.toLocaleString()`.
    expect(screen.getByText(/9,000/)).toBeInTheDocument();
    // 9000 / (9000 + 1000 + 500) = 85.71...% → rounds to 86%.
    expect(screen.getByText(/86%/)).toBeInTheDocument();
    // ★ Pins the FOLLOW-UP fix: UsageBar's own `used`/`cap` figures now take
    //   the same `locale` prop as the breakdown below it, rather than calling
    //   bare `.toLocaleString()` (host-default locale). The GROUPING SEPARATOR
    //   is what this pins — the total beside it is incidental to that.
    // ★★ The total is the COST-EQUIVALENT one, not a raw sum: 1000*1 + 100*5
    //   + 500*1.25 + 9000*0.1 = 3025. It read 10600 until the caps moved onto
    //   the billing weights; the bar has always shown sessionTotal, and it is
    //   sessionTotal's basis that changed underneath it.
    expect(screen.getByText(/3,025 \/ 100,000/)).toBeInTheDocument();
    expect(screen.getByText(/3,025 \/ 500,000/)).toBeInTheDocument();
  });

  it("orders the session cache breakdown and hit-rate between the session and weekly bars", () => {
    render(
      <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
      { wrapper: seededWrapper("en-US", CACHE_USAGE) },
    );
    // Every session-scoped figure (the breakdown + hit-rate) belongs next to
    // the session bar it describes, not stranded under the weekly bar/reset
    // line — assert DOM order directly so a future reorder that puts them
    // back under the weekly heading fails here, not just by inspection.
    const sessionLabel = screen.getByText(t("en-US", "aiUsageSession"));
    // ★★ THE `<dl>` MUST BE IN THIS CHAIN, not just the hit rate. An earlier
    //    revision asserted over the hit rate alone while the test's NAME and
    //    comment promised the breakdown too — moving the `<dl>` BY ITSELF back
    //    under the weekly bar left it green. `aiUsageUncachedInput` is the
    //    `<dl>`'s first row, so anchoring on it covers the whole block.
    const breakdownFirstRow = screen.getByText(t("en-US", "aiUsageUncachedInput"));
    const hitRate = screen.getByText(t("en-US", "aiUsageCacheHitRate", "86"));
    const weekLabel = screen.getByText(t("en-US", "aiUsageWeek"));
    // aiUsageResetAt interpolates a locale-formatted date via {0}; match on
    // the fixed "Resets " prefix rather than the full string.
    const resetLine = screen.getByText(/^Resets /);

    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(sessionLabel.compareDocumentPosition(breakdownFirstRow) & FOLLOWING).toBeTruthy();
    expect(breakdownFirstRow.compareDocumentPosition(hitRate) & FOLLOWING).toBeTruthy();
    expect(hitRate.compareDocumentPosition(weekLabel) & FOLLOWING).toBeTruthy();
    expect(weekLabel.compareDocumentPosition(resetLine) & FOLLOWING).toBeTruthy();
  });

  it("hides the hit rate entirely when no input-side tokens have been counted", () => {
    // ★ The hit rate would otherwise render a confident "0%", asserting a
    //   measurement nobody took. `inputSide` sums input + cacheRead +
    //   cacheWrite, so all three must be zero to reach the hidden branch —
    //   `output` is deliberately non-zero here to prove it is NOT in the
    //   denominator (a mutant folding output into `inputSide` would render
    //   the line again and turn this red).
    render(
      <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
      {
        wrapper: seededWrapper("en-US", {
          input: 0,
          output: 250,
          cacheWrite: 0,
          cacheRead: 0,
        }),
      },
    );
    expect(screen.queryByText(/Cache hit rate/)).toBeNull();
    // Positive control: the panel really rendered, so the absence above is a
    // hidden line and not an empty render.
    expect(screen.getByText(t("en-US", "aiUsageSession"))).toBeInTheDocument();
  });

  it("shows the output row, which carries the heaviest weight", () => {
    render(
      <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
      {
        wrapper: seededWrapper("en-US", {
          input: 100,
          output: 10,
          cacheWrite: 20,
          cacheRead: 1000,
        }),
      },
    );
    expect(screen.getByText(t("en-US", "aiUsageOutput"))).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("renders raw API counts in the breakdown, not cost-weighted ones", () => {
    // ★★ THE NEGATIVE HALF NEEDS A LIVE MUTANT, and the one that stood here
    //    had none: it looked for "5,000" against a fixture where nothing could
    //    produce 5,000 under ANY weighting, so it was unfalsifiable. The
    //    weights are input 1 · cacheWrite 1.25 · cacheRead 0.1 · output 5, so a
    //    weighted sessionUsage would render cacheRead as 1000 * 0.1 = "100" —
    //    that IS reachable, and asserting its absence goes red the moment the
    //    provider starts scaling what it stores. `input` is 300 rather than 100
    //    precisely so the raw input row cannot supply a "100" of its own and
    //    make the negative pass for the wrong reason.
    render(
      <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
      {
        wrapper: seededWrapper("en-US", {
          input: 300,
          output: 10,
          cacheWrite: 20,
          cacheRead: 1000,
        }),
      },
    );
    expect(screen.getByText("1,000")).toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
    expect(screen.queryByText("100")).not.toBeInTheDocument();
  });

  it("rounds a fractional cost-equivalent total at the display boundary", () => {
    render(
      <AiUsagePanel lang="en-US" sessionCap={200_000} weeklyCap={1_000_000} />,
      { wrapper: seededWrapper("en-US", FRACTIONAL_USAGE) },
    );
    // Both bars read the same total here (one session, one week-to-date).
    expect(screen.getByText(/20,010 \/ 200,000/)).toBeInTheDocument();
    expect(screen.getByText(/20,010 \/ 1,000,000/)).toBeInTheDocument();
    // ★ The mutant: drop Math.round and this renders "20,009.85".
    expect(screen.queryByText(/20,009\.85/)).not.toBeInTheDocument();
    // ★★ aria-valuenow is the half a sighted reviewer cannot see — assistive
    //    tech was being handed a fractional progress value.
    const values = screen
      .getAllByRole("progressbar")
      .map((b) => b.getAttribute("aria-valuenow"));
    expect(values).toEqual(["20010", "20010"]);
  });

  it("says what unit the bars are in", () => {
    render(
      <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
      {
        wrapper: seededWrapper("en-US", {
          input: 100,
          output: 10,
          cacheWrite: 20,
          cacheRead: 1000,
        }),
      },
    );
    expect(screen.getByText(t("en-US", "aiUsageBasisHint"))).toBeInTheDocument();
  });

  // ★★★ THIS EXPLANATION USED TO BE A TOAST AND WAS NEVER PAINTED. `useToast`
  //     holds one `Toast | null` slot with no queue, and every call site fired
  //     it in the same tick as its own cap warning, so React batched the pair
  //     and only the warning rendered — while the localStorage flag had already
  //     been written, so it could never come back. The five tests that "proved"
  //     it worked asserted on `showToast.mock.calls`: the mock's ARGUMENTS, not
  //     what the toast host rendered. Worse, the crossing detectors could not
  //     reach the audience anyway — `crossed80`/`crossed100` both require
  //     `prevUsed < threshold`, so a device already at or above its cap at
  //     mount crossed nothing, and that is precisely the upgrading device the
  //     explanation exists for. A panel line beside the numbers needs no edge.
  describe("the changed-cost-basis explanation", () => {
    const noticeText = t("en-US", "aiUsageCostBasisChanged");

    it("explains the changed basis to an upgrading device and records WHEN, not merely THAT", () => {
      seedUpgradingDevice();
      render(
        <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
        { wrapper },
      );

      expect(screen.getByText(noticeText)).toBeInTheDocument();
      // ★★ The cost key stores the ISO timestamp of the first observation, NOT
      //    a boolean — that timestamp is the only thing that can give the line
      //    the week-long lifetime its own text promises. Asserting it is not
      //    "1" is the half that goes red on a revert to the one-shot flag.
      const stored = localStorage.getItem(AI_COST_BASIS_NOTICE_KEY);
      expect(stored).not.toBe("1");
      expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
      expect(Number.isNaN(new Date(stored ?? "").getTime())).toBe(false);
      // ★ The cap key stays a bare sentinel — only the cost key has a
      //   lifetime. Stamping it is what stops the superseded cap-basis notice
      //   re-announcing a change already announced.
      expect(localStorage.getItem(AI_CAP_BASIS_NOTICE_KEY)).toBe("1");
    });

    it("keeps showing on a remount within the same week, without extending the window", () => {
      seedUpgradingDevice();
      const first = render(
        <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
        { wrapper },
      );
      const stampedAt = localStorage.getItem(AI_COST_BASIS_NOTICE_KEY);
      expect(screen.getByText(noticeText)).toBeInTheDocument();
      first.unmount();

      // A second Settings visit inside the same week. The one-shot flag this
      // replaced hid the line here, while the user's history stayed
      // mis-scaled for the rest of the week with nothing on screen to say so.
      render(
        <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
        { wrapper },
      );
      expect(screen.getByText(noticeText)).toBeInTheDocument();
      // ★★★ The stamp must NOT be refreshed. Re-stamping "now" on every mount
      //     would slide the window forward forever, so the line could never
      //     expire — the same defect as never showing it, just louder.
      expect(localStorage.getItem(AI_COST_BASIS_NOTICE_KEY)).toBe(stampedAt);
    });

    it("stops showing once the stored week has reset", () => {
      seedUpgradingDevice();
      // A first observation far enough in the past that its week reset long
      // ago. Chosen over faking the clock deliberately: the stored value IS
      // the input under test, and a fixed past date can never race the real
      // "today" the way a relative offset can (a 6-hour offset lands in the
      // PREVIOUS week whenever the test runs early on a Monday).
      localStorage.setItem(AI_COST_BASIS_NOTICE_KEY, "2000-01-01T00:00:00.000Z");
      render(
        <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
        { wrapper },
      );

      expect(screen.queryByText(noticeText)).toBeNull();
      expect(screen.getByText(t("en-US", "aiUsageBasisHint"))).toBeInTheDocument();
    });

    it("never shows it for an unparseable stored value", () => {
      seedUpgradingDevice();
      // Degrade to silence, never to a notice that cannot expire: a value we
      // cannot date has no computable window, so showing it would strand the
      // line on screen forever.
      localStorage.setItem(AI_COST_BASIS_NOTICE_KEY, "not-a-date");
      render(
        <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
        { wrapper },
      );

      expect(screen.queryByText(noticeText)).toBeNull();
      expect(screen.getByText(t("en-US", "aiUsageBasisHint"))).toBeInTheDocument();
    });

    it("never shows it for a stamp in the future, which no week can reset past", () => {
      seedUpgradingDevice();
      // ★★ A device whose clock was briefly wrong at first observation. This
      //    value PARSES, so the unparseable guard does not catch it, and the
      //    window comparison alone would keep the line up until 2999 — the
      //    same cannot-expire failure, reached by a different route.
      localStorage.setItem(AI_COST_BASIS_NOTICE_KEY, "2999-01-01T00:00:00.000Z");
      render(
        <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
        { wrapper },
      );

      expect(screen.queryByText(noticeText)).toBeNull();
      expect(screen.getByText(t("en-US", "aiUsageBasisHint"))).toBeInTheDocument();
    });

    it("places the explanation immediately after the unit hint, not stranded elsewhere", () => {
      seedUpgradingDevice();
      render(
        <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
        { wrapper },
      );
      // The unit explanation and the history caveat are one block: what the
      // bars count, then why the older numbers look different.
      const hint = screen.getByText(t("en-US", "aiUsageBasisHint"));
      const notice = screen.getByText(noticeText);
      expect(hint.nextElementSibling).toBe(notice);
    });

    it("never shows it for the legacy \"1\" sentinel, whatever the date today", () => {
      seedUpgradingDevice();
      // ★★ Every pre-0.297 device carries this: written by the retired toast
      //    path, or seeded on a fresh install. It must keep meaning "never
      //    show", and it must NOT be read as a date — `new Date("1")` is the
      //    year 2001, not an Invalid Date (verified in V8), so a parse that
      //    ran before this branch would be reading a timestamp nobody wrote.
      localStorage.setItem(AI_COST_BASIS_NOTICE_KEY, "1");
      render(
        <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
        { wrapper },
      );

      expect(screen.queryByText(noticeText)).toBeNull();
      // Positive control: the panel really rendered, so the absence above is a
      // hidden line and not an empty render.
      expect(screen.getByText(t("en-US", "aiUsageBasisHint"))).toBeInTheDocument();
    });

    it("never shows it to a fresh install, which had no old scale to be on", () => {
      // localStorage is clear (beforeEach) — no usage blob has ever been
      // written, so AiUsageProvider seeds both flags at mount.
      render(
        <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
        { wrapper },
      );

      expect(screen.queryByText(noticeText)).toBeNull();
      expect(screen.getByText(t("en-US", "aiUsageBasisHint"))).toBeInTheDocument();
    });

    it("degrades to hiding the line when localStorage throws", () => {
      seedUpgradingDevice();
      const spy = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(() => {
          throw new Error("SecurityError");
        });
      try {
        // A settings panel that crashes is worse than a notice nobody sees.
        render(
          <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
          { wrapper },
        );
        expect(screen.queryByText(noticeText)).toBeNull();
        expect(screen.getByText(t("en-US", "aiUsageBasisHint"))).toBeInTheDocument();
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("in German", () => {
    beforeAll(async () => {
      await loadI18n("de");
    });

    it("renders the German cache-breakdown and hit-rate strings", () => {
      render(
        <AiUsagePanel lang="de" sessionCap={100_000} weeklyCap={500_000} />,
        { wrapper: seededWrapper("de", CACHE_USAGE) },
      );
      expect(screen.getByText(t("de", "aiUsageUncachedInput"))).toBeInTheDocument();
      expect(screen.getByText(t("de", "aiUsageCacheRead"))).toBeInTheDocument();
      expect(screen.getByText(t("de", "aiUsageCacheWrite"))).toBeInTheDocument();
      // German grouping uses "." — 9000 renders as "9.000" under "de-DE".
      expect(screen.getByText(/9\.000/)).toBeInTheDocument();
      expect(screen.getByText(/86 %/)).toBeInTheDocument();
      // ★ Same follow-up pin as the "en-US" test above, in the German
      //   direction: the bar figures must use dot grouping under "de".
      //   3025 is the cost-equivalent session total; see the en-US test.
      expect(screen.getByText(/3\.025 \/ 100\.000/)).toBeInTheDocument();
      expect(screen.getByText(/3\.025 \/ 500\.000/)).toBeInTheDocument();
    });
  });
});

// §702: the week's view-switch counter, rendered under the weekly bar.
type SendSeed = { viewText: string; startedAt: number; cacheWrite: number; requests: number };

function SeedSends({ sends, children }: { sends: SendSeed[]; children: ReactNode }) {
  const { recordChatSend } = useAiUsageContext();
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    for (const [i, s] of sends.entries()) {
      recordChatSend(
        {
          threadKey: "p|t",
          model: "m",
          toolNames: "t",
          stableText: "S",
          viewText: s.viewText,
          startedAt: s.startedAt,
          lastRequestAt: s.startedAt + 5_000,
          // Each later send continues the conversation.
          priorTurns: 2 + 2 * i,
        },
        s.cacheWrite,
        s.requests,
      );
    }
  }, [recordChatSend, sends]);
  return <>{children}</>;
}

function sendsWrapper(lang: Lang, sends: SendSeed[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AiUsageProvider lang={lang} ai={defaultAiConfig} showToast={vi.fn()}>
        <SeedSends sends={sends}>{children}</SeedSends>
      </AiUsageProvider>
    );
  };
}

// Three messages in one thread, six API requests between them: the first is
// cold (nothing before it, 20,000 written), the second changes the view block
// inside the cache window (a switch, 9,000), the third changes nothing (warm,
// 600). The cold write must stay out of both averages, and the switch rate is
// per REQUEST, the break-even's unit.
const THREE_SENDS: SendSeed[] = [
  { viewText: "A", startedAt: 1_000, cacheWrite: 20_000, requests: 1 },
  { viewText: "B", startedAt: 61_000, cacheWrite: 9_000, requests: 2 },
  { viewText: "B", startedAt: 121_000, cacheWrite: 600, requests: 3 },
];

describe("AiUsagePanel — weekly hard cap notice (AI-03)", () => {
  function hardCapWrapper(weeklyHardCap: number | undefined) {
    const ai = { ...defaultAiConfig, weeklyHardCap };
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <Seed usage={CACHE_USAGE}>
          <AiUsageProvider lang="en-US" ai={ai} showToast={vi.fn()}>
            {children}
          </AiUsageProvider>
        </Seed>
      );
    };
  }

  it("shows the paused notice with the reset date once the cap is reached", () => {
    render(<AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />, { wrapper: hardCapWrapper(100) });
    const reset = nextWeekReset(new Date()).toLocaleString(localeFor("en-US"), { dateStyle: "medium", timeStyle: "short" });
    expect(screen.getByText(t("en-US", "aiHardCapPausedNotice", reset))).toBeInTheDocument();
  });

  it("shows no notice below the cap or without one", () => {
    const { unmount } = render(<AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />, {
      wrapper: hardCapWrapper(10_000_000),
    });
    expect(screen.queryByText(/background AI is paused/i)).toBeNull();
    unmount();
    render(<AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />, { wrapper: hardCapWrapper(undefined) });
    expect(screen.queryByText(/background AI is paused/i)).toBeNull();
  });
});

describe("AiUsagePanel — view-switch counter (§702)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows nothing about view switches before the first chat message", () => {
    render(<AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />, { wrapper });
    expect(screen.queryByText("Chat messages completed this week")).not.toBeInTheDocument();
  });

  it("shows the week's messages and requests, warm view switches per request, and cache-write tokens", () => {
    render(<AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />, {
      wrapper: sendsWrapper("en-US", THREE_SENDS),
    });
    expect(screen.getByText("Chat messages completed this week").nextElementSibling).toHaveTextContent(
      "3 (6 API requests)",
    );
    expect(screen.getByText("View switches with a warm cache").nextElementSibling).toHaveTextContent(
      "1 (1 in 6 API requests)",
    );
    expect(screen.getByText("Cache-write tokens per message").nextElementSibling).toHaveTextContent(
      "9,000 on a switch, 600 on other warm messages",
    );
    // ★ "more often than", so a rate of 1 in 30 cannot read as below the line.
    expect(
      screen.getByText(/pays off when view switches happen more often than about one in 46 API requests/),
    ).toBeInTheDocument();
    // The register's slice name is not user vocabulary.
    expect(screen.queryByText(/G2/)).not.toBeInTheDocument();
  });

  it("says there is nothing to move while operating guides are off, instead of quoting the break-even", () => {
    render(<AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} guidesOn={false} />, {
      wrapper: sendsWrapper("en-US", THREE_SENDS),
    });
    // The setting is named by its own label, quoted the way filters quote.
    expect(
      screen.getByText(
        `${t("en-US", "filterQuotedValue", t("en-US", "aiGroundInGuides"))} is off, so no view guides are sent and there is nothing to move out of the cached prompt.`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/46 API requests/)).not.toBeInTheDocument();
  });

  it("says no ratio and no average for a side with no messages", () => {
    render(<AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />, {
      wrapper: sendsWrapper("en-US", [
        { viewText: "A", startedAt: 1_000, cacheWrite: 20_000, requests: 1 },
        { viewText: "A", startedAt: 61_000, cacheWrite: 400, requests: 1 },
      ]),
    });
    expect(screen.getByText("View switches with a warm cache").nextElementSibling).toHaveTextContent(/^0$/);
    expect(screen.getByText("Cache-write tokens per message").nextElementSibling).toHaveTextContent(
      "— on a switch, 400 on other warm messages",
    );
  });

  describe("in German", () => {
    beforeAll(async () => {
      await loadI18n("de");
    });

    it("renders the German labels and German number grouping", () => {
      render(<AiUsagePanel lang="de" sessionCap={100_000} weeklyCap={500_000} />, {
        wrapper: sendsWrapper("de", THREE_SENDS),
      });
      expect(screen.getByText("Abgeschlossene Chat-Nachrichten diese Woche").nextElementSibling).toHaveTextContent(
        "3 (6 API-Anfragen)",
      );
      expect(screen.getByText("Ansichtswechsel bei warmem Cache").nextElementSibling).toHaveTextContent(
        "1 (1 von 6 API-Anfragen)",
      );
      expect(screen.getByText("Cache-Schreib-Tokens pro Nachricht").nextElementSibling).toHaveTextContent(
        "9.000 bei einem Wechsel, 600 bei anderen warmen Nachrichten",
      );
    });

    it("quotes the German setting label when operating guides are off", () => {
      render(<AiUsagePanel lang="de" sessionCap={100_000} weeklyCap={500_000} guidesOn={false} />, {
        wrapper: sendsWrapper("de", THREE_SENDS),
      });
      expect(screen.getByText(/^\u201EClaude an Betriebsleitf\u00E4den binden\u201C ist aus/)).toBeInTheDocument();
    });
  });
});
