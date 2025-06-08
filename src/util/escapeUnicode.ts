export function escapeUnicode(str: string): string {
  return [...str]
    .map((c) =>
      // eslint-disable-next-line no-control-regex
      /^[\x00-\x7F]$/.test(c)
        ? c
        : c
            .split('')
            .map((a) => '\\u' + a.charCodeAt(0).toString(16).padStart(4, '0'))
            .join('')
    )
    .join('');
}
