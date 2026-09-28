export const INITIAL_WAIT_MILLISECONDS = 5 * 60 * 1000;
export const POLLING_INTERVAL_MILLISECONDS = 15 * 1000;

export async function wait(milliseconds: number): Promise<string> {
    return new Promise((resolve) => {
        if (isNaN(milliseconds)) {
            throw new Error("milliseconds not a number");
        }

        setTimeout(() => resolve("done!"), milliseconds);
    });
}
