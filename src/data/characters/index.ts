import type { CharacterDef } from '../types';
import { blaze } from './blaze';
import { zephyr } from './zephyr';
import { bastion } from './bastion';
import { phantom } from './phantom';
import { ray } from './ray';
import { volt } from './volt';
import { kinesis } from './kinesis';
import { blood } from './blood';

/** Registration order = character index used in the simulation state. */
export const CHARACTERS: readonly CharacterDef[] = [blaze, zephyr, bastion, phantom, ray, volt, kinesis, blood];

export const charIndex = (id: string): number => CHARACTERS.findIndex((c) => c.id === id);
