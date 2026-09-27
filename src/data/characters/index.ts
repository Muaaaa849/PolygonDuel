import type { CharacterDef } from '../types';
import { blaze } from './blaze';
import { zephyr } from './zephyr';
import { bastion } from './bastion';

/** Registration order = character index used in the simulation state. */
export const CHARACTERS: readonly CharacterDef[] = [blaze, zephyr, bastion];

export const charIndex = (id: string): number => CHARACTERS.findIndex((c) => c.id === id);
