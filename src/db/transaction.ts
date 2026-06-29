import type { SqlDriver } from "./types";

export async function runInTransaction<T>(
  driver: SqlDriver,
  operation: (transactionDriver: SqlDriver) => Promise<T>,
): Promise<T> {
  if (driver.transaction) {
    return driver.transaction(operation);
  }

  await driver.execute("BEGIN");
  try {
    const result = await operation(driver);
    await driver.execute("COMMIT");
    return result;
  } catch (error) {
    await driver.execute("ROLLBACK");
    throw error;
  }
}
