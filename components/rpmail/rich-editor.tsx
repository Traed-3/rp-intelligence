'use client'

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { Bold, Italic, Underline, List, ListOrdered, Link as LinkIcon, Unlink, RemoveFormatting } from 'lucide-react'
import { cn } from '@/lib/utils'
import { cleanRich, escHtml, linkFromTyped } from '@/lib/rpmail/rich'

// The message box with a formatting bar: bold, italic, underline, bulleted and numbered lists, links.
// The box holds only what lib/rpmail/rich.ts allows: anything pasted or dropped in is rewritten by `cleanRich` first, so
// what is on screen is what will be sent. The server rewrites it again before sending; nothing here is trusted there.
// The browser's own editing commands do the work (document.execCommand): old, but every browser and phone still has them.

export type RichHandle = {
  /** Replace everything in the box. */
  set: (html: string) => void
  /** Put this where the typing cursor is (or at the top if the cursor is somewhere else). */
  insert: (html: string) => void
  focus: () => void
}

type On = { b: boolean; i: boolean; u: boolean; ul: boolean; ol: boolean; a: boolean }
const OFF: On = { b: false, i: false, u: false, ul: false, ol: false, a: false }

const edit = (cmd: string, value?: string) => { try { return document.execCommand(cmd, false, value) } catch { return false } }
const state = (cmd: string) => { try { return document.queryCommandState(cmd) } catch { return false } }

function Btn({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={active}
      // Keeps the words selected: without this, pressing the button would take the cursor out of the message.
      onMouseDown={e => e.preventDefault()} onClick={onClick}
      className={cn('inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-raised hover:text-foreground [&_svg]:size-4', active && 'bg-primary/10 text-foreground')}>
      {children}
    </button>
  )
}

export function RichEditor({ initial, onChange, onFiles, autoFocus, ref, label = 'Message' }: {
  initial: string; onChange: (html: string) => void; onFiles?: (files: File[]) => void; autoFocus?: boolean; ref?: Ref<RichHandle>; label?: string }) {
  const [first] = useState(() => cleanRich(initial).html)
  const box = useRef<HTMLDivElement>(null)
  const last = useRef<Range | null>(null)                          // where the cursor was, so a tap on a button does not lose it
  const [on, setOn] = useState<On>(OFF)
  const [link, setLink] = useState<{ url: string; had: boolean; err: string } | null>(null)

  const inBox = (n: Node | null) => !!n && !!box.current && box.current.contains(n)
  const anchorAt = (n: Node | null): HTMLAnchorElement | null => {
    for (let x = n; x && x !== box.current; x = x.parentNode) if (x instanceof HTMLAnchorElement) return x
    return null
  }
  const emit = useCallback(() => { if (box.current) onChange(box.current.innerHTML) }, [onChange])

  /** Put the cursor back in the box where it last was (a press on a button, the link row or a menu can take it away). */
  const restore = () => {
    const el = box.current, sel = window.getSelection()
    if (!el || !sel) return
    if (document.activeElement === el && sel.rangeCount && inBox(sel.anchorNode)) return
    // Worked out before focus() is called: giving the box the focus drops the cursor at its very top.
    const r = last.current && inBox(last.current.startContainer) && inBox(last.current.endContainer) ? last.current : null
    el.focus()
    sel.removeAllRanges()
    if (r) sel.addRange(r)
    else { const top = document.createRange(); top.selectNodeContents(el); top.collapse(true); sel.addRange(top) }
  }

  useEffect(() => {
    const read = () => {
      const sel = window.getSelection()
      if (!sel || !sel.rangeCount || !inBox(sel.anchorNode)) return
      last.current = sel.getRangeAt(0).cloneRange()
      const next: On = { b: state('bold'), i: state('italic'), u: state('underline'), ul: state('insertUnorderedList'), ol: state('insertOrderedList'), a: !!anchorAt(sel.anchorNode) }
      setOn(o => (Object.keys(next) as (keyof On)[]).every(k => o[k] === next[k]) ? o : next)
    }
    document.addEventListener('selectionchange', read)
    return () => document.removeEventListener('selectionchange', read)
  }, [])

  // The starting words are put in once, by hand. After that the box owns its own contents: React is given nothing to
  // draw inside it, so a re-draw of the page can never wipe out what is being typed.
  useLayoutEffect(() => { if (box.current) box.current.innerHTML = first }, [first])
  useEffect(() => { if (autoFocus) box.current?.focus() }, [autoFocus])

  useImperativeHandle(ref, () => ({
    set: html => { if (box.current) { box.current.innerHTML = cleanRich(html).html; last.current = null; emit() } },
    insert: html => { restore(); edit('insertHTML', cleanRich(html).html); emit() },
    focus: () => box.current?.focus(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `restore` only reads refs
  }), [emit])

  const run = (cmd: string) => { restore(); edit('styleWithCSS', 'false'); edit(cmd); emit() }

  const openLink = () => {
    restore()
    const a = anchorAt(window.getSelection()?.anchorNode ?? null)
    setLink({ url: a?.getAttribute('href')?.replace(/^mailto:/i, '') ?? '', had: !!a, err: '' })
  }
  const applyLink = () => {
    if (!link) return
    const href = linkFromTyped(link.url)
    if (!href) { setLink({ ...link, err: 'That does not look like a web address or an email address.' }); return }
    restore()
    const sel = window.getSelection(), a = anchorAt(sel?.anchorNode ?? null)
    if (a) a.setAttribute('href', href)
    else if (sel && sel.isCollapsed) edit('insertHTML', `<a href="${escHtml(href).replace(/"/g, '&quot;')}">${escHtml(href.replace(/^mailto:/i, ''))}</a>`)
    else edit('createLink', href)
    setLink(null); emit()
  }
  const removeLink = () => {
    restore()
    const sel = window.getSelection(), a = anchorAt(sel?.anchorNode ?? null)
    if (a && sel) { const r = document.createRange(); r.selectNodeContents(a); sel.removeAllRanges(); sel.addRange(r) }
    edit('unlink'); setLink(null); emit()
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatting">
        <Btn title="Bold (Ctrl or Cmd + B)" active={on.b} onClick={() => run('bold')}><Bold /></Btn>
        <Btn title="Italic (Ctrl or Cmd + I)" active={on.i} onClick={() => run('italic')}><Italic /></Btn>
        <Btn title="Underline (Ctrl or Cmd + U)" active={on.u} onClick={() => run('underline')}><Underline /></Btn>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Btn title="Bulleted list" active={on.ul} onClick={() => run('insertUnorderedList')}><List /></Btn>
        <Btn title="Numbered list" active={on.ol} onClick={() => run('insertOrderedList')}><ListOrdered /></Btn>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Btn title="Link (Ctrl or Cmd + K)" active={on.a || !!link} onClick={() => link ? setLink(null) : openLink()}><LinkIcon /></Btn>
        <Btn title="Take the formatting off the selected words" onClick={() => run('removeFormat')}><RemoveFormatting /></Btn>
      </div>
      {link && (
        <div className="mb-1 rounded-md border border-border bg-raised p-2">
          <div className="flex flex-wrap items-center gap-2">
            <input className="rp-input !w-auto min-w-0 flex-1 !py-1 text-sm" autoFocus placeholder="Web address or email address" aria-label="Link address" value={link.url}
              onChange={e => setLink({ ...link, url: e.target.value, err: '' })}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLink() } else if (e.key === 'Escape') { e.stopPropagation(); setLink(null); restore() } }} />
            <button type="button" className="text-sm underline" onClick={applyLink}>{link.had ? 'Change link' : 'Add link'}</button>
            {link.had && <button type="button" className="inline-flex items-center gap-1 text-sm underline" onClick={removeLink}><Unlink className="size-3.5" />Remove link</button>}
            <button type="button" className="text-sm text-muted-foreground underline" onClick={() => { setLink(null); restore() }}>Cancel</button>
          </div>
          {link.err && <p className="mt-1 text-xs text-danger">{link.err}</p>}
        </div>
      )}
      <div ref={box} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label} spellCheck
        className="rp-input min-h-[200px] max-h-[55vh] overflow-y-auto font-sans break-words [&_a]:text-primary [&_a]:underline [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
        onInput={e => {
          // Something dragged in from another page arrives with that page's own markup: rewrite the box so it shows what will be sent.
          if ((e.nativeEvent as InputEvent).inputType === 'insertFromDrop' && box.current) box.current.innerHTML = cleanRich(box.current.innerHTML).html
          emit()
        }}
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openLink() } }}
        onPaste={e => {
          const files = [...e.clipboardData.files]
          if (files.length) { e.preventDefault(); onFiles?.(files); return }
          const html = e.clipboardData.getData('text/html')
          e.preventDefault()
          if (html) edit('insertHTML', cleanRich(html).html)
          else edit('insertText', e.clipboardData.getData('text/plain'))
          emit()
        }} />
    </div>
  )
}
