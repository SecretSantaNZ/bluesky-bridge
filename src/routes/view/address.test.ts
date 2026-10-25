import { describe, expect, it } from 'vitest';
import { addressReviewRequired, ensureAddressEditable } from './address.js';
import { BadRequestError } from 'http-errors-enhanced';

describe('addressReviewRequired', () => {
  it('marks overseas addresses for manual review', () => {
    expect(addressReviewRequired('12 Queen St')).toBe(true);
    expect(addressReviewRequired('42 Melbourne Way, Australia')).toBe(true);
  });

  it('accepts New Zealand and Aotearoa addresses regardless of case', () => {
    expect(addressReviewRequired('12 Queen St, New Zealand')).toBe(false);
    expect(addressReviewRequired('aotearoa, 12 Queen St')).toBe(false);
    expect(addressReviewRequired('Whangārei, AOTEAROA')).toBe(false);
  });
});

describe('ensureAddressEditable', () => {
  it('allows editing addresses that have not been sent yet', () => {
    expect(() =>
      ensureAddressEditable({ locked_giftee_for_count: 0 })
    ).not.toThrow();
    expect(() =>
      ensureAddressEditable({ locked_giftee_for_count: null as never })
    ).not.toThrow();
  });

  it('blocks editing once the address has been sent to a santa', () => {
    expect(() => ensureAddressEditable({ locked_giftee_for_count: 1 })).toThrow(
      BadRequestError
    );
  });
});
