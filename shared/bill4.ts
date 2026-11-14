/**
 * Bill Chud 4 implementation rules (release-backed). The original bill text stays archival on the official record.
 * Policy is executed by the referenced release, not by interpreting that original text.
 */

/** Exact identity hash of the official Bill 4 row: SHA-256 of JSON.stringify([number, day, text, by_name, at]). */
export const BILL4_IDENTITY_SHA256 = '26c59fcfc90b3b2897a058fa5d1e704136382c2518028972b5d341d264b369c9';
export const BILL4_NUMBER = '4';
export const BILL4_DAY = '2026-11-13';
export const BILL4_BY = 'carter2';
export const BILL4_AT = 1794633705056;
/** Official original submission text (archival). Used only to verify the identity hash. */
export const BILL4_ORIGINAL_TEXT = 'all zoning limits increased by 5';

/** Public enacted wording (revised, exact terms). Does not replace the archival original. */
export const BILL4_IMPLEMENTATION_TEXT =
  'New acquisitions are limited separately to 10 residential deeds and 10 commercial deeds per citizen. Commercial includes barns and all shop, factory and other landmark deeds. Farmland, including farm plots, fields, Big Farms and plantations, is limited to 2,000 full-plot tiles per citizen. Existing holdings remain grandfathered, including holdings above a cap; zoning caps do not force sales or confiscation, but block additional acquisitions in that category. Resort lots and land patches remain exempt. The property purchase surcharge stays abolished. Base prices, the price index, purchase and daily wealth-tax rules and rates, ordinary property-tax rules, historical paid/city basis and sell-back rules are unchanged.';
