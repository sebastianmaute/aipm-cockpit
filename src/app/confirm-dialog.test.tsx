import { StrictMode } from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider, useConfirm, useNotice, usePrompt, type AppDialogs, type ConfirmFn } from "./confirm-dialog";
import { buttonClassFor } from "../test/button-variant";

// Synchronous rAF shim so the Modal focus-management effect runs immediately.
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

function Harness({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await confirm({ message: "Delete this widget?" });
        onResult(ok);
      }}
    >
      trigger
    </button>
  );
}

function renderHarness(onResult: (v: boolean) => void) {
  return render(
    <ConfirmProvider lang="en-US">
      <Harness onResult={onResult} />
    </ConfirmProvider>,
  );
}

describe("ConfirmProvider / useConfirm", () => {
  test("does not render a dialog until confirm() is called", () => {
    renderHarness(() => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // §102: Cancel is the shared secondary Button, and it still takes focus when the
  // dialog opens (the ref now goes through the primitive). The confirm button stays
  // hand-rolled: its colour comes from the dialog's tone.
  test("renders Cancel as the secondary Button and focuses it on open", async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    await user.click(screen.getByRole("button", { name: "trigger" }));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel.className).toBe(buttonClassFor({ variant: "secondary", size: "sm" }));
    await waitFor(() => expect(cancel).toHaveFocus());
  });

  test("opens a dialog with the supplied message and default title", async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    await user.click(screen.getByRole("button", { name: "trigger" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Delete this widget?")).toBeInTheDocument();
    expect(screen.getByText("Please confirm")).toBeInTheDocument();
  });

  test("Confirm resolves the promise true and closes the dialog", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderHarness(onResult);
    await user.click(screen.getByRole("button", { name: "trigger" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Cancel resolves the promise false and closes the dialog", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderHarness(onResult);
    await user.click(screen.getByRole("button", { name: "trigger" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Escape resolves the promise false (dismiss = decline)", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderHarness(onResult);
    await user.click(screen.getByRole("button", { name: "trigger" }));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("custom title, labels and default danger tone are honoured", async () => {
    const user = userEvent.setup();
    function CustomHarness() {
      const confirm = useConfirm();
      return (
        <button
          type="button"
          onClick={() => {
            void confirm({
              message: "msg",
              title: "Remove item",
              confirmLabel: "Remove",
              cancelLabel: "Keep",
            });
          }}
        >
          go
        </button>
      );
    }
    render(
      <ConfirmProvider lang="en-US">
        <CustomHarness />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByText("Remove item")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
  });

  test("backdrop click resolves the promise false and closes", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderHarness(onResult);
    await user.click(screen.getByRole("button", { name: "trigger" }));
    const dialog = screen.getByRole("dialog");
    // Modal closes on a press+click that both start and end on the backdrop.
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("a superseding confirm resolves the previous prompt as declined", async () => {
    const user = userEvent.setup();
    const results: boolean[] = [];
    function Multi() {
      const confirm = useConfirm();
      return (
        <button
          type="button"
          onClick={() => {
            void confirm({ message: "first" }).then((v) => results.push(v));
            void confirm({ message: "second" }).then((v) => results.push(v));
          }}
        >
          go
        </button>
      );
    }
    render(
      <ConfirmProvider lang="en-US">
        <Multi />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: "go" }));
    // The first prompt was superseded by the second → resolved false; only the
    // second dialog is shown.
    await waitFor(() => expect(results).toContain(false));
    expect(screen.getByText("second")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(results).toEqual([false, true]));
  });
});

describe("ConfirmProvider bridgeRef (§715 D5)", () => {
  // Code ABOVE the provider (task-manager's hooks) cannot call useConfirm: the provider fills a ref
  // it is given instead.
  test("hands the provider's dialog to a ref outside it", async () => {
    const ref: { current: ConfirmFn } = { current: async () => false };
    render(<ConfirmProvider lang="en-US" bridgeRef={ref}><span /></ConfirmProvider>);
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => { answer = ref.current({ message: "Delete task #7?" }); });
    expect(await screen.findByText("Delete task #7?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await expect(answer).resolves.toBe(true);
  });
});

// §752 — the app's own text prompt and notice, replacing window.prompt (which throws in the desktop app)
// and window.alert. Same provider, one dialog at a time.
function PromptHarness({ onResult, defaultValue }: { onResult: (v: string | null) => void; defaultValue?: string }) {
  const prompt = usePrompt();
  return (
    <button type="button" onClick={async () => onResult(await prompt({ message: "Email address for Elena", defaultValue, inputType: "email" }))}>
      ask
    </button>
  );
}

function NoticeHarness({ onDone }: { onDone: () => void }) {
  const notice = useNotice();
  return <button type="button" onClick={async () => { await notice({ message: "That address cannot be used." }); onDone(); }}>tell</button>;
}

describe("ConfirmProvider — usePrompt (§752)", () => {
  function renderPrompt(onResult: (v: string | null) => void, defaultValue?: string) {
    return render(<ConfirmProvider lang="en-US"><PromptHarness onResult={onResult} defaultValue={defaultValue} /></ConfirmProvider>);
  }

  test("the message labels a focused input, and OK answers what was typed", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderPrompt(onResult);
    await user.click(screen.getByRole("button", { name: "ask" }));
    const input = await screen.findByRole("textbox", { name: "Email address for Elena" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAttribute("type", "email");
    await user.type(input, "elena@example.org");
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("elena@example.org"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Enter in the input answers too", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderPrompt(onResult);
    await user.click(screen.getByRole("button", { name: "ask" }));
    await user.type(await screen.findByRole("textbox", { name: "Email address for Elena" }), "a@b.co{Enter}");
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("a@b.co"));
  });

  test("Cancel answers null", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderPrompt(onResult);
    await user.click(screen.getByRole("button", { name: "ask" }));
    await user.type(await screen.findByRole("textbox", { name: "Email address for Elena" }), "typed");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(null));
  });

  test("Escape answers null", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderPrompt(onResult);
    await user.click(screen.getByRole("button", { name: "ask" }));
    await screen.findByRole("textbox", { name: "Email address for Elena" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(null));
  });

  test("the default value is filled in", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderPrompt(onResult, "https://");
    await user.click(screen.getByRole("button", { name: "ask" }));
    expect(await screen.findByRole("textbox", { name: "Email address for Elena" })).toHaveValue("https://");
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("https://"));
  });
});

describe("ConfirmProvider — useNotice (§752)", () => {
  test("shows the message with one OK button, focused; OK closes it", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<ConfirmProvider lang="en-US"><NoticeHarness onDone={onDone} /></ConfirmProvider>);
    await user.click(screen.getByRole("button", { name: "tell" }));
    expect(await screen.findByText("That address cannot be used.")).toBeInTheDocument();
    const ok = screen.getByRole("button", { name: "OK" });
    await waitFor(() => expect(ok).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await user.click(ok);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ConfirmProvider dialogsRef (§752)", () => {
  test("hands all three dialogs to a ref outside it, and a new one answers an open one with its no", async () => {
    const ref: { current: AppDialogs } = {
      current: { confirm: async () => false, prompt: async () => null, notice: async () => {} },
    };
    render(<ConfirmProvider lang="en-US" dialogsRef={ref}><span /></ConfirmProvider>);
    let typed: Promise<string | null> = Promise.resolve("unset");
    act(() => { typed = ref.current.prompt({ message: "Name this version" }); });
    expect(await screen.findByRole("textbox", { name: "Name this version" })).toBeInTheDocument();
    let confirmed: Promise<boolean> = Promise.resolve(false);
    act(() => { confirmed = ref.current.confirm({ message: "Send 2 emails?" }); });
    await expect(typed).resolves.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await expect(confirmed).resolves.toBe(true);
    let toldDone = false;
    let told: Promise<void> = Promise.resolve();
    act(() => { told = ref.current.notice({ message: "Done." }).then(() => { toldDone = true; }); });
    fireEvent.click(await screen.findByRole("button", { name: "OK" }));
    await told;
    expect(toldDone).toBe(true);
  });
});

describe("ConfirmProvider — one dialog replacing another (§752 review)", () => {
  // KILLED BY: dropping `key={pending.seq}` (the Modal stays mounted, its initial focus never runs again).
  test("the new dialog takes focus", async () => {
    const ref: { current: AppDialogs } = {
      current: { confirm: async () => false, prompt: async () => null, notice: async () => {} },
    };
    render(<ConfirmProvider lang="en-US" dialogsRef={ref}><span /></ConfirmProvider>);
    act(() => { void ref.current.prompt({ message: "Name this version" }); });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Name this version" })).toHaveFocus());
    act(() => { void ref.current.confirm({ message: "Send 2 emails?" }); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
  });

  // The replaced dialog is answered "no"; the replacing one stays open and takes its own answer.
  test("the replaced dialog's answer is its no, and the new one stays open", async () => {
    const ref: { current: AppDialogs } = {
      current: { confirm: async () => false, prompt: async () => null, notice: async () => {} },
    };
    render(<ConfirmProvider lang="en-US" dialogsRef={ref}><span /></ConfirmProvider>);
    let first: Promise<boolean> = Promise.resolve(true);
    act(() => { first = ref.current.confirm({ message: "First?" }); });
    let second: Promise<boolean> = Promise.resolve(false);
    act(() => { second = ref.current.confirm({ message: "Second?" }); });
    await expect(first).resolves.toBe(false);
    expect(await screen.findByText("Second?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await expect(second).resolves.toBe(true);
  });
});

describe("ConfirmProvider — unmounting with a dialog open (§752 review)", () => {
  // KILLED BY: dropping the unmount cleanup (the prompt's promise never settles, and the ref keeps the dead provider).
  test("answers the open dialog with its no, and hands the ref back unbridged", async () => {
    const ref: { current: AppDialogs } = {
      current: { confirm: async () => false, prompt: async () => null, notice: async () => {} },
    };
    const view = render(<ConfirmProvider lang="en-US" dialogsRef={ref}><span /></ConfirmProvider>);
    const live = ref.current;
    let typed: Promise<string | null> = Promise.resolve("unset");
    act(() => { typed = ref.current.prompt({ message: "Name this version" }); });
    await screen.findByRole("textbox", { name: "Name this version" });
    view.unmount();
    await expect(typed).resolves.toBeNull();
    expect(ref.current).not.toBe(live);
    await expect(ref.current.confirm({ message: "after" })).resolves.toBe(false);
  });
});

describe("ConfirmProvider — StrictMode (§752 review)", () => {
  // StrictMode runs the unmount cleanup and the effects again on mount: the ref must end up BRIDGED.
  test("the ref is bridged after StrictMode's double mount", async () => {
    const ref: { current: AppDialogs } = {
      current: { confirm: async () => false, prompt: async () => null, notice: async () => {} },
    };
    const before = ref.current;
    render(<StrictMode><ConfirmProvider lang="en-US" dialogsRef={ref}><span /></ConfirmProvider></StrictMode>);
    expect(ref.current).not.toBe(before);
    act(() => { void ref.current.confirm({ message: "Still bridged?" }); });
    expect(await screen.findByText("Still bridged?")).toBeInTheDocument();
  });
});
