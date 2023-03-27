/**
 * Delay for a specified time in milliseconds
 * @param ms
 */
export function delay(ms: number) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}