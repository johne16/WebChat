// extension/extraction.js

/**
 * Extract user-visible and interactive HTML from a page.
 * Returns a clean HTML fragment string (no <html>/<head>/<body> wrapper).
 *
 * Usage:
 *   import { extractUserVisibleHTML } from './extraction.js';
 *   const html = extractUserVisibleHTML(document);
 *
 * @param {Document|string} input  A Document or an HTML string.
 * @param {Object} [opts]
 * @param {boolean} [opts.stripEventHandlers=true]  Drop on* attributes.
 * @param {boolean} [opts.keepTimedTextTracks=false] Keep <track> in <audio>/<video>.
 * @param {string[]} [opts.extraAdHints=[]]  Extra substrings to treat as ad-like.
 * @returns {string}
 */
export function extractUserVisibleHTML(input, opts = {}) {
    const options = {
        stripEventHandlers: true,
        keepTimedTextTracks: false,
        extraAdHints: [],
        ...opts,
    };

    const doc = toDocument(input);
    const work = doc.cloneNode(true);

    // Remove top-level boilerplate
    if (work.head) work.documentElement.removeChild(work.head);

    // Drop comments
    removeAllComments(work);

    // Remove discard tags globally
    const DISCARD_TAGS = new Set([
        'SCRIPT',
        'STYLE',
        'NOSCRIPT',
        'TEMPLATE',
        'SLOT',
        'LINK',
        'META',
        'BASE',
    ]);

    // Keep list reflects the agreed policy (includes interactive/visible UI)
    const KEEP_TAGS = new Set([
        'HEADER','NAV','FOOTER','ASIDE',
        'MAIN','ARTICLE','SECTION',
        'H1','H2','H3','H4','H5','H6','P','BR','HR',
        'UL','OL','LI','DL','DT','DD',
        'A',
        'IMG','PICTURE','SOURCE',
        'FIGURE','FIGCAPTION',
        'BLOCKQUOTE','Q','CITE',
        'PRE','CODE','KBD','SAMP',
        'TABLE','THEAD','TBODY','TFOOT','TR','TH','TD','COL','COLGROUP','CAPTION',
        'FORM','LABEL','INPUT','SELECT','TEXTAREA','BUTTON',
        'DETAILS','SUMMARY','DIALOG','MENU','MENUITEM',
        'VIDEO','AUDIO','TRACK',
        'IFRAME','EMBED','OBJECT',
        'SVG','CANVAS',
        'MAP','AREA',
        'DIV','SPAN',
        'STRONG','EM','B','I','U','MARK','SMALL','SUB','SUP',
        'TIME','DATA','VAR','ABBR','DFN'
    ]);

    // Remove discard tags quickly
    for (const tag of DISCARD_TAGS) {
        for (const el of Array.from(work.getElementsByTagName(tag))) {
            el.remove();
        }
    }

    // Walk body and prune undesired nodes and ad/analytics
    const walker = work.createTreeWalker(work.body || work, NodeFilter.SHOW_ELEMENT, null);
    const toRemove = [];

    while (walker.nextNode()) {
        const el = /** @type {Element} */ (walker.currentNode);

        // Ad/analytics and junk heuristics
        if (isAdLike(el, options.extraAdHints)) {
            toRemove.push(el);
            continue;
        }

        // Unknown tags not on KEEP list: remove but keep text fallback if any
        if (!KEEP_TAGS.has(el.tagName)) {
            toRemove.push(el);
            continue;
        }

        // Per-element cleanup
        sanitizeAttributes(el, options.stripEventHandlers);

        switch (el.tagName) {
            case 'SVG':
                cleanSVG(el);
                break;
            case 'VIDEO':
            case 'AUDIO':
                if (!options.keepTimedTextTracks) {
                    for (const t of Array.from(el.getElementsByTagName('track'))) t.remove();
                }
                // Media should not autoplay in extracted HTML
                el.removeAttribute('autoplay');
                el.removeAttribute('muted');
                el.removeAttribute('loop');
                break;
            case 'IFRAME':
                // Keep as a placeholder; retain safe attrs only
                keepOnlyAttrs(el, ['src','title','width','height','allow','allowfullscreen','loading','referrerpolicy']);
                break;
            case 'EMBED':
            case 'OBJECT':
                keepOnlyAttrs(el, ['src','data','type','width','height','title']);
                break;
            case 'CANVAS':
                // Keep element for page location only
                keepOnlyAttrs(el, ['id','class','width','height','title','role']);
                break;
            default:
                // no-op
                break;
        }
    }

    // Remove collected nodes
    for (const n of toRemove) n.remove();

    // Return inner HTML of body (or whole doc if body missing)
    const container = work.body || work.documentElement || work;
    return container.innerHTML.trim();
}

/* ----------------------------- helpers ----------------------------- */

function toDocument(input) {
    if (isDocument(input)) return input;
    if (typeof input === 'string') {
        const parser = new DOMParser();
        return parser.parseFromString(input, 'text/html');
    }
    throw new TypeError('extractUserVisibleHTML: input must be Document or HTML string');
}

function isDocument(x) {
    return x && typeof x === 'object' && x.nodeType === Node.DOCUMENT_NODE && typeof x.createElement === 'function';
}

function removeAllComments(root) {
    const walker = root.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    const toRemove = [];
    while (walker.nextNode()) toRemove.push(walker.currentNode);
    for (const c of toRemove) c.parentNode && c.parentNode.removeChild(c);
}

function isAdLike(el, extraHints) {
    const HINTS = ['ad','ads','advert','advertisement','adunit','banner','sponsor','sponsored','promo','promoted'];
    const hints = new Set([...HINTS, ...(extraHints || [])].map(s => s.toLowerCase()));
    const hay = [
        el.id || '',
        el.getAttribute('name') || '',
        el.getAttribute('aria-label') || '',
        ...Array.from(el.classList),
        ...Array.from(el.attributes).filter(a => a.name.startsWith('data-')).map(a => `${a.name}:${a.value}`)
    ]
        .join(' ')
        .toLowerCase();

    // whole-word-ish match to avoid "adapter" false positives
    for (const h of hints) {
        const re = new RegExp(`(^|[^a-z0-9])${escapeRe(h)}([^a-z0-9]|$)`, 'i');
        if (re.test(hay)) return true;
    }
    return false;
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Keep safe, text-relevant attributes; drop event handlers and JS URLs.
 */
function sanitizeAttributes(el, stripHandlers) {
    const SAFE_ATTRS = new Set([
        // identity and selection
        'id','class',
        // text semantics
        'title','alt',
        // links and media
        'href','src','srcset','sizes','poster',
        // forms
        'name','value','type','placeholder','for','action','method','min','max','step','checked','selected','multiple','required','disabled',
        // layout hints
        'width','height','colspan','rowspan','scope',
        // ARIA and roles
        'role',
    ]);

    // Preserve all aria-* attributes
    // Preserve data-* except ad-like ones (filtered earlier)
    const toRemove = [];
    for (const { name, value } of Array.from(el.attributes)) {
        const lower = name.toLowerCase();

        if (stripHandlers && lower.startsWith('on')) {
            toRemove.push(name);
            continue;
        }

        if (lower === 'href' || lower === 'src' || lower === 'action') {
            if (value && /^\s*javascript:/i.test(value)) {
                toRemove.push(name);
                continue;
            }
        }

        if (
            SAFE_ATTRS.has(name) ||
            lower.startsWith('aria-') ||
            lower.startsWith('data-')
        ) {
            continue;
        }

        // Allow limited <a> attributes useful for locating
        if (el.tagName === 'A' && (lower === 'target' || lower === 'rel')) continue;

        toRemove.push(name);
    }
    for (const n of toRemove) el.removeAttribute(n);

    // Normalize rel on links with target=_blank
    if (el.tagName === 'A' && el.getAttribute('target') === '_blank') {
        const rel = new Set(String(el.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
        rel.add('noopener'); rel.add('noreferrer');
        el.setAttribute('rel', Array.from(rel).join(' '));
    }
}

/**
 * Keep only text-bearing SVG content for readability.
 * Allow <text>, <tspan>, <title>, <desc>. Strip styling/scripts and shapes.
 */
function cleanSVG(svgEl) {
    const ALLOWED = new Set(['svg','text','tspan','title','desc']);
    const walker = svgEl.ownerDocument.createTreeWalker(svgEl, NodeFilter.SHOW_ELEMENT, null);
    const toRemove = [];
    while (walker.nextNode()) {
        const el = /** @type {Element} */ (walker.currentNode);
        if (!ALLOWED.has(el.tagName.toLowerCase())) {
            if (el !== svgEl) toRemove.push(el);
        } else {
            // sanitize attributes on allowed nodes
            sanitizeAttributes(el, true);
        }
    }
    for (const n of toRemove) n.remove();
}

/**
 * Keep only a specific whitelist of attributes on an element.
 */
function keepOnlyAttrs(el, keepList) {
    const keep = new Set(keepList.map(a => a.toLowerCase()).concat(['id','class','title','role','aria-*']));
    for (const { name } of Array.from(el.attributes)) {
        const lower = name.toLowerCase();
        if (keep.has(lower)) continue;
        if (lower.startsWith('aria-') && keep.has('aria-*')) continue;
        el.removeAttribute(name);
    }
}
