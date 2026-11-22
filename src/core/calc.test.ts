import { describe, it, expect } from 'vitest';
import { evalCalc, pressCalc } from './calc';

const type = (keys: string) => [...keys].reduce(pressCalc, '');

describe('calculadora', () => {
  it('faz as contas com prioridades e percentagens', () => {
    expect(evalCalc('12.5+3*2')).toBe(18.5);
    expect(evalCalc('0.1+0.2')).toBe(0.3);
    expect(evalCalc('10-4-3')).toBe(3);
    expect(evalCalc('8/2/2')).toBe(2);
    expect(evalCalc('200-10%')).toBe(180);
    expect(evalCalc('200*10%')).toBe(20);
    expect(evalCalc('-5+8')).toBe(3);
    expect(evalCalc('7+')).toBe(7);
  });
  it('contas impossíveis ou vazias dão null', () => {
    expect(evalCalc('')).toBeNull();
    expect(evalCalc('5/0')).toBeNull();
    expect(evalCalc('-')).toBeNull();
  });
  it('não deixa escrever coisas sem sentido', () => {
    expect(type('1+*2')).toBe('1*2');
    expect(type('1..5')).toBe('1.5');
    expect(type('.5')).toBe('0.5');
    expect(type('007')).toBe('7');
    expect(type('+3')).toBe('3');
    expect(type('5%%')).toBe('5%');
  });
});
