/**
 * The notebook model barrel: the ONLY import point for model types and helpers outside core/model.
 * (Files inside core/model import each other directly, so there are no cycles.)
 */
export * from './types.ts';
export * from './paper.ts';
export * from './ids.ts';
export * from './location.ts';
export * from './codec.ts';
export * from './readers.ts';
export * from './migrate.ts';
export * from './settings.ts';
export * from './patches.ts';
export * from './history.ts';
export { patternFor, lineColorFor } from '../paper/pattern.ts';
