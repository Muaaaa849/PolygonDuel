import type { CharacterDef } from '../types';
import { blaze } from './blaze';
import { zephyr } from './zephyr';
import { bastion } from './bastion';
import { phantom } from './phantom';

/** Registration order = character index used in the simulation state. */
export const CHARACTERS: readonly CharacterDef[] = [blaze, zephyr, bastion, phantom];

export const charIndex = (id: string): number => CHARACTERS.findIndex((c) => c.id === id);
