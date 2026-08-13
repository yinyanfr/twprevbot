type RepeatingChatActionOptions = {
  intervalMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  onError?: (error: unknown) => void;
};

export function startRepeatingChatAction(
  sendAction: () => Promise<unknown>,
  options: RepeatingChatActionOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? 4_000;
  const wait = options.wait ?? delay;
  let active = true;
  let stopWaiting!: () => void;
  const stopped = new Promise<void>((resolve) => {
    stopWaiting = resolve;
  });

  void (async () => {
    while (active) {
      try {
        await sendAction();
      } catch (error) {
        options.onError?.(error);
      }

      if (active) {
        await Promise.race([wait(intervalMs), stopped]);
      }
    }
  })();

  return () => {
    if (!active) {
      return;
    }

    active = false;
    stopWaiting();
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}
