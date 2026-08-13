export class SerialTaskQueue {
  #tail = Promise.resolve();

  async run<T>(task: () => Promise<T>): Promise<T> {
    const previousTask = this.#tail;
    let releaseTask!: () => void;
    this.#tail = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });

    await previousTask;
    try {
      return await task();
    } finally {
      releaseTask();
    }
  }
}
