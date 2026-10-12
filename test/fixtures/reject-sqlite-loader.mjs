import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:sqlite') {
      throw new Error('SQLite must not be loaded for lightweight CLI commands.');
    }
    return nextResolve(specifier, context, nextResolve);
  }
});
