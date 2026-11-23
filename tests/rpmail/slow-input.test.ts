import { describe, expect, it } from 'vitest'
import { cleanRich, keptWording, withoutEnding } from '@/lib/rpmail/rich'
import { sanitizeHtml } from '@/lib/rpmail/mail-ops'
import { htmlToText, dropBlocks } from '@/lib/rpmail/parse'
import { htmlHasQuote, shownText, ownPictures, wantsRemotePictures, splitPlainQuote } from '@/lib/rpmail/thread-view'

// Input built to waste time. Anyone can send mail to a mailbox, and anyone signed in can post a message to be sent,
// so everything that reads either must take time in step with its length, never with its length squared.
// Before this was fixed: 40,000 odd spaces in a message took the sender's request 2.5 seconds (9 minutes at the size
// limit), and mail made of 20,000 unclosed <script tags took 5 seconds to open (over a minute at full size).

const ms = (fn: () => unknown) => { const t = performance.now(); fn(); return performance.now() - t }
const N = 150_000
const quick = (name: string, fn: () => unknown, budget = 1500) => it(name, () => { expect(ms(fn)).toBeLessThan(budget) })

describe('a message being sent', () => {
  quick('a long run of odd spaces', () => cleanRich('<div>' + ' '.repeat(N) + 'x</div>'))
  quick('a long run of the same, written as codes', () => cleanRich('<div>' + '&nbsp;'.repeat(N / 2) + 'x</div>'))
  quick('spaces and tabs that are not at the end of a line', () => cleanRich('<div>a' + ' \t&#32;&#9;'.repeat(N / 4) + 'b</div>'))
  quick('thousands of empty lines', () => cleanRich('<div><br></div>'.repeat(N / 5)))
  quick('a signature or template made of empty lines', () => keptWording('<div>x</div>' + '<div><br></div>'.repeat(15_000) + '<div>y</div>', '', 20_000))
  quick('cutting a signature off a message of empty lines', () => withoutEnding('<div>x</div>' + '<div><br></div>'.repeat(15_000) + '<div>Ann</div>', 'Bob'), 3000)

  it('still takes spaces off the ends of lines, and empty lines off kept wording, as before', () => {
    expect(cleanRich('<div>one \t </div><div>two&nbsp;&nbsp;</div><div>three  </div>last  ').text).toBe('one\ntwo\nthree\nlast ')
    expect(cleanRich('a  \n  b').text).toBe('a b')
    expect(keptWording('<div><br></div><div><br></div><div><b>Ann</b></div><div><br></div><div>RP</div><div><br></div>', '', 4000)).toEqual({ text: 'Ann\n\nRP', html: '<div><b>Ann</b></div><div><br></div><div>RP</div>' })
    expect(withoutEnding('<div><i>Hi</i></div><div><br></div><div><br></div><div>Ann</div>', 'Ann')).toBe('<div><i>Hi</i></div>')
  })
})

describe('mail that was received', () => {
  for (const tag of ['script', 'iframe', 'object', 'embed', 'noscript', 'form', 'link', 'base', 'meta']) {
    quick(`thousands of <${tag} tags that never close`, () => sanitizeHtml(`<${tag} `.repeat(N / 8)))
    quick(`thousands of <${tag}> blocks with no closing tag`, () => sanitizeHtml(`<${tag}>x`.repeat(N / 8)))
  }
  quick('opening and closing tags of different kinds, interleaved', () => sanitizeHtml('<script><iframe><object></noscript>'.repeat(N / 30)))
  quick('a flood of "on..." attributes with no value', () => sanitizeHtml(' onx '.repeat(N / 5) + ' ony=' + '"'.repeat(3)))
  quick('a flood of "<" for the text reader', () => htmlToText('<'.repeat(N * 2)))
  quick('a flood of unclosed <style for the text reader', () => htmlToText('<style '.repeat(N / 7)))
  quick('a flood of tags with long insides for the text reader', () => htmlToText(('<br' + ' '.repeat(200) + 'x>').repeat(1500)))
  quick('a flood of half-written pictures and quotes for the reader', () => {
    const imgs = '<img alt="x" '.repeat(N / 13), quotes = '<blockquote data-x="y" '.repeat(N / 23), classes = 'class="a b c '.repeat(N / 13)
    for (const h of [imgs, quotes, classes]) { htmlHasQuote(h); ownPictures(h); wantsRemotePictures(h); shownText(h, true) }
  })
  quick('plain text made to look like quoted mail over and over', () => {
    for (const t of ['\nOn '.repeat(N / 4), '\n' + ' '.repeat(N), '\n_'.repeat(N / 2), ('\nOn ' + 'x'.repeat(190)).repeat(N / 200), '\nFrom: x'.repeat(N / 8)]) splitPlainQuote(t)
  })

  // The single-pass versions must take out exactly what the old patterns took out. The old ones are kept here to check against.
  const oldSanitize = (h: string) => h.replace(/<(script|iframe|object|embed|noscript)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<\/?(script|iframe|object|embed|noscript|form|link|base|meta)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/javascript:/gi, 'blocked:')
  const oldToText = (h: string) => {
    let t = h.replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    t = t.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, ' ')
    t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_m, n: string) => { try { return String.fromCodePoint(+n) } catch { return ' ' } })
    return t.replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim()
  }
  const samples = [
    '<div dir="ltr">Hi Ann,<div><br></div><div>Can you <b>confirm</b> the order?</div><br>Pat &amp; Bo</div>',
    '<p>One</p><script>alert(1)</script><p>Two</p><SCRIPT type="x">evil()</SCRIPT >Three',
    'a<script>b<script>c</script>d</script>e', '<noscript><script>x</script><img src=x onerror="steal()"></noscript>shown',
    'before<embed src="x.swf">after<object data="y"><param name="a">inside</object>end', '<embed src=x>text<embed>more</embed>end',
    '<iframe src="https://evil.example"></iframe>ok<iframe src="never closed">this stays as words',
    '<form action="https://evil.example"><input name="q"><button>Go</button></form><link rel="stylesheet" href="x"><base href="//evil.example/"><meta http-equiv="refresh" content="0">',
    '<a href="javascript:alert(1)" onclick="x()" onmouseover=y() ONLOAD=\'z()\'>link</a> <div style="color:red" online="1">not an event: online=1 goes too</div>',
    '<head><title>T</title><style>p{color:red}</style></head><body><h1>Title</h1><p>Para one</p><table><tr><td>a</td><td>b</td></tr></table><ul><li>x</li><li>y</li></ul></body>',
    '2 < 3 and 5 > 4', 'a <> b <i>c</i>', 'a <<b>> c', 'tail with an open tag <b', '', 'no tags at all &nbsp;&amp;&lt;&gt;&quot;&#39;&#8212;',
    '<style>unclosed style p{}', 'x<script>', '</script>stray closer</iframe>', '<SCRIPT>a</script><Script>b</SCRIPT>c',
    '<br><br/><br /><BR>line</p></div></tr></li></h2>end', '<p>a</p>\n\n\n<p>b</p>   <p>c</p>',
  ]

  it('takes out of received HTML exactly what it always took out', () => {
    for (const s of samples) expect(sanitizeHtml(s), s).toBe(oldSanitize(s))
    for (const s of samples) expect(sanitizeHtml(s)).not.toMatch(/<\/?(script|iframe|object|embed|noscript|form|link|base|meta)\b[^>]*>/i)
  })

  it('reads the words out of received HTML exactly as it always did', () => {
    for (const s of samples) expect(htmlToText(s), s).toBe(oldToText(s))
  })

  it('differs from the old way only where a tag never ends: nothing after it is shown, as in a browser', () => {
    expect(sanitizeHtml('shown <meta http-equiv="refresh" content="0;url=https://evil.example"')).toBe('shown ')
    expect(sanitizeHtml('shown <form action=x onsubmit=y')).toBe('shown ')
    expect(sanitizeHtml('x<script')).toBe('x')
  })

  it('drops whole blocks by name, and leaves an unclosed one alone', () => {
    expect(dropBlocks('a<style>x</style>b<STYLE >y</style >c', 'script|style', '|')).toBe('a|b|c')
    expect(dropBlocks('a<style>never closed <style>again', 'script|style')).toBe('a<style>never closed <style>again')
    expect(dropBlocks('a<styled>not a style block</styled>', 'script|style')).toBe('a<styled>not a style block</styled>')
  })
})
