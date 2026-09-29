import { transaction } from "../../db/connection";

/** Keeps observable side effects outside database transactions, including savepoints. */
export class RuntimeTransaction {
  private effects: (() => void)[] | null = null;

  defer(effect: () => void) {
    if (this.effects) this.effects.push(effect);
    else effect();
  }

  run<T>(write: () => T, rollback: () => void): T {
    const parent = this.effects;
    const effects: (() => void)[] = [];
    this.effects = effects;
    let result: T;
    try {
      result = transaction(write);
    } catch (error) {
      rollback();
      throw error;
    } finally {
      this.effects = parent;
    }
    if (parent) parent.push(...effects);
    else for (const effect of effects) effect();
    return result;
  }
}
