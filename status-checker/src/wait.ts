export const MILLISECONDS_PER_SECOND = 1000;
export const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;
export const INITIAL_WAIT_MILLISECONDS = 5 * MILLISECONDS_PER_MINUTE;
export const POLLING_INTERVAL_MILLISECONDS = 15 * MILLISECONDS_PER_SECOND;

export async function wait(milliseconds: number): Promise<string> {
    return new Promise((resolve) => {
        if (isNaN(milliseconds)) {
            throw new Error("milliseconds not a number");
        }

        setTimeout(() => resolve("done!"), milliseconds);
    });
}
