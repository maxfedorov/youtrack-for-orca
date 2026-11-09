// Runs async tasks one after another, so read-modify-write cycles on storage cannot interleave.

/** @returns {<T>(task: () => Promise<T>) => Promise<T>} */
export function createSerial() {
  let tail = Promise.resolve()
  return (task) => {
    const run = tail.then(task)
    tail = run.then(() => undefined, () => undefined)
    return run
  }
}
