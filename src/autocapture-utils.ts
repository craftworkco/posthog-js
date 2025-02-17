import { AutocaptureConfig, Properties } from 'types'
import { _each, _entries, _includes, _trim } from './utils'

import { _isArray, _isNull, _isString, _isUndefined } from './utils/type-utils'
import { logger } from './utils/logger'
import { window } from './utils/globals'

/*
 * Get the className of an element, accounting for edge cases where element.className is an object
 *
 * Because this is a string it can contain unexpected characters
 * So, this method safely splits the className and returns that array.
 */
export function getClassNames(el: Element): string[] {
    let className = ''
    switch (typeof el.className) {
        case 'string':
            className = el.className
            break
        // TODO: when is this ever used?
        case 'object': // handle cases where className might be SVGAnimatedString or some other type
            className =
                ('baseVal' in el.className ? (el.className as any).baseVal : null) || el.getAttribute('class') || ''
            break
        default:
            className = ''
    }

    return className.length ? _trim(className).split(/\s+/) : []
}

/*
 * Get the direct text content of an element, protecting against sensitive data collection.
 * Concats textContent of each of the element's text node children; this avoids potential
 * collection of sensitive data that could happen if we used element.textContent and the
 * element had sensitive child elements, since element.textContent includes child content.
 * Scrubs values that look like they could be sensitive (i.e. cc or ssn number).
 * @param {Element} el - element to get the text of
 * @returns {string} the element's direct text content
 */
export function getSafeText(el: Element): string {
    let elText = ''

    if (shouldCaptureElement(el) && !isSensitiveElement(el) && el.childNodes && el.childNodes.length) {
        _each(el.childNodes, function (child) {
            if (isTextNode(child) && child.textContent) {
                elText += _trim(child.textContent)
                    // scrub potentially sensitive values
                    .split(/(\s+)/)
                    .filter(shouldCaptureValue)
                    .join('')
                    // normalize whitespace
                    .replace(/[\r\n]/g, ' ')
                    .replace(/[ ]+/g, ' ')
                    // truncate
                    .substring(0, 255)
            }
        })
    }

    return _trim(elText)
}

/*
 * Check whether an element has nodeType Node.ELEMENT_NODE
 * @param {Element} el - element to check
 * @returns {boolean} whether el is of the correct nodeType
 */
export function isElementNode(el: Element | undefined | null): el is HTMLElement {
    return !!el && el.nodeType === 1 // Node.ELEMENT_NODE - use integer constant for browser portability
}

/*
 * Check whether an element is of a given tag type.
 * Due to potential reference discrepancies (such as the webcomponents.js polyfill),
 * we want to match tagNames instead of specific references because something like
 * element === document.body won't always work because element might not be a native
 * element.
 * @param {Element} el - element to check
 * @param {string} tag - tag name (e.g., "div")
 * @returns {boolean} whether el is of the given tag type
 */
export function isTag(el: Element | undefined | null, tag: string): el is HTMLElement {
    return !!el && !!el.tagName && el.tagName.toLowerCase() === tag.toLowerCase()
}

/*
 * Check whether an element has nodeType Node.TEXT_NODE
 * @param {Element} el - element to check
 * @returns {boolean} whether el is of the correct nodeType
 */
export function isTextNode(el: Element | undefined | null): el is HTMLElement {
    return !!el && el.nodeType === 3 // Node.TEXT_NODE - use integer constant for browser portability
}

/*
 * Check whether an element has nodeType Node.DOCUMENT_FRAGMENT_NODE
 * @param {Element} el - element to check
 * @returns {boolean} whether el is of the correct nodeType
 */
export function isDocumentFragment(el: Element | ParentNode | undefined | null): el is DocumentFragment {
    return !!el && el.nodeType === 11 // Node.DOCUMENT_FRAGMENT_NODE - use integer constant for browser portability
}

export const autocaptureCompatibleElements = ['a', 'button', 'form', 'input', 'select', 'textarea', 'label']
/*
 * Check whether a DOM event should be "captured" or if it may contain sentitive data
 * using a variety of heuristics.
 * @param {Element} el - element to check
 * @param {Event} event - event to check
 * @param {Object} autocaptureConfig - autocapture config
 * @returns {boolean} whether the event should be captured
 */
export function shouldCaptureDomEvent(
    el: Element,
    event: Event,
    autocaptureConfig: AutocaptureConfig | undefined = undefined
): boolean {
    if (!window || !el || isTag(el, 'html') || !isElementNode(el)) {
        return false
    }

    if (autocaptureConfig?.url_allowlist) {
        const url = window.location.href
        const allowlist = autocaptureConfig.url_allowlist
        if (allowlist && !allowlist.some((regex) => url.match(regex))) {
            return false
        }
    }

    if (autocaptureConfig?.dom_event_allowlist) {
        const allowlist = autocaptureConfig.dom_event_allowlist
        if (allowlist && !allowlist.some((eventType) => event.type === eventType)) {
            return false
        }
    }

    if (autocaptureConfig?.element_allowlist) {
        const allowlist = autocaptureConfig.element_allowlist
        if (allowlist && !allowlist.some((elementType) => el.tagName.toLowerCase() === elementType)) {
            return false
        }
    }

    if (autocaptureConfig?.css_selector_allowlist) {
        const allowlist = autocaptureConfig.css_selector_allowlist
        if (allowlist && !allowlist.some((selector) => el.matches(selector))) {
            return false
        }
    }

    let parentIsUsefulElement = false
    const targetElementList: Element[] = [el] // TODO: remove this var, it's never queried
    let parentNode: Element | boolean = true
    let curEl: Element = el
    while (curEl.parentNode && !isTag(curEl, 'body')) {
        // If element is a shadow root, we skip it
        if (isDocumentFragment(curEl.parentNode)) {
            targetElementList.push((curEl.parentNode as any).host)
            curEl = (curEl.parentNode as any).host
            continue
        }
        parentNode = (curEl.parentNode as Element) || false
        if (!parentNode) break
        if (autocaptureCompatibleElements.indexOf(parentNode.tagName.toLowerCase()) > -1) {
            parentIsUsefulElement = true
        } else {
            const compStyles = window.getComputedStyle(parentNode)
            if (compStyles && compStyles.getPropertyValue('cursor') === 'pointer') {
                parentIsUsefulElement = true
            }
        }

        targetElementList.push(parentNode)
        curEl = parentNode
    }

    const compStyles = window.getComputedStyle(el)
    if (compStyles && compStyles.getPropertyValue('cursor') === 'pointer' && event.type === 'click') {
        return true
    }

    const tag = el.tagName.toLowerCase()
    switch (tag) {
        case 'html':
            return false
        case 'form':
            return event.type === 'submit'
        case 'input':
            return event.type === 'change' || event.type === 'click'
        case 'select':
        case 'textarea':
            return event.type === 'change' || event.type === 'click'
        default:
            if (parentIsUsefulElement) return event.type === 'click'
            return (
                event.type === 'click' &&
                (autocaptureCompatibleElements.indexOf(tag) > -1 || el.getAttribute('contenteditable') === 'true')
            )
    }
}

/*
 * Check whether a DOM element should be "captured" or if it may contain sentitive data
 * using a variety of heuristics.
 * @param {Element} el - element to check
 * @returns {boolean} whether the element should be captured
 */
export function shouldCaptureElement(el: Element): boolean {
    for (let curEl = el; curEl.parentNode && !isTag(curEl, 'body'); curEl = curEl.parentNode as Element) {
        const classes = getClassNames(curEl)
        if (_includes(classes, 'ph-sensitive') || _includes(classes, 'ph-no-capture')) {
            return false
        }
    }

    if (_includes(getClassNames(el), 'ph-include')) {
        return true
    }

    // don't include hidden or password fields
    const type = (el as HTMLInputElement).type || ''
    if (_isString(type)) {
        // it's possible for el.type to be a DOM element if el is a form with a child input[name="type"]
        switch (type.toLowerCase()) {
            case 'hidden':
                return false
            case 'password':
                return false
        }
    }

    // filter out data from fields that look like sensitive fields
    const name = (el as HTMLInputElement).name || el.id || ''
    // See https://github.com/posthog/posthog-js/issues/165
    // Under specific circumstances a bug caused .replace to be called on a DOM element
    // instead of a string, removing the element from the page. Ensure this issue is mitigated.
    if (_isString(name)) {
        // it's possible for el.name or el.id to be a DOM element if el is a form with a child input[name="name"]
        const sensitiveNameRegex =
            /^cc|cardnum|ccnum|creditcard|csc|cvc|cvv|exp|pass|pwd|routing|seccode|securitycode|securitynum|socialsec|socsec|ssn/i
        if (sensitiveNameRegex.test(name.replace(/[^a-zA-Z0-9]/g, ''))) {
            return false
        }
    }

    return true
}

/*
 * Check whether a DOM element is 'sensitive' and we should only capture limited data
 * @param {Element} el - element to check
 * @returns {boolean} whether the element should be captured
 */
export function isSensitiveElement(el: Element): boolean {
    // don't send data from inputs or similar elements since there will always be
    // a risk of clientside javascript placing sensitive data in attributes
    const allowedInputTypes = ['button', 'checkbox', 'submit', 'reset']
    if (
        (isTag(el, 'input') && !allowedInputTypes.includes((el as HTMLInputElement).type)) ||
        isTag(el, 'select') ||
        isTag(el, 'textarea') ||
        el.getAttribute('contenteditable') === 'true'
    ) {
        return true
    }
    return false
}

/*
 * Check whether a string value should be "captured" or if it may contain sentitive data
 * using a variety of heuristics.
 * @param {string} value - string value to check
 * @returns {boolean} whether the element should be captured
 */
export function shouldCaptureValue(value: string): boolean {
    if (_isNull(value) || _isUndefined(value)) {
        return false
    }

    if (_isString(value)) {
        value = _trim(value)

        // check to see if input value looks like a credit card number
        // see: https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9781449327453/ch04s20.html
        const ccRegex =
            /^(?:(4[0-9]{12}(?:[0-9]{3})?)|(5[1-5][0-9]{14})|(6(?:011|5[0-9]{2})[0-9]{12})|(3[47][0-9]{13})|(3(?:0[0-5]|[68][0-9])[0-9]{11})|((?:2131|1800|35[0-9]{3})[0-9]{11}))$/
        if (ccRegex.test((value || '').replace(/[- ]/g, ''))) {
            return false
        }

        // check to see if input value looks like a social security number
        const ssnRegex = /(^\d{3}-?\d{2}-?\d{4}$)/
        if (ssnRegex.test(value)) {
            return false
        }
    }

    return true
}

/*
 * Check whether an attribute name is an Angular style attr (either _ngcontent or _nghost)
 * These update on each build and lead to noise in the element chain
 * More details on the attributes here: https://angular.io/guide/view-encapsulation
 * @param {string} attributeName - string value to check
 * @returns {boolean} whether the element is an angular tag
 */
export function isAngularStyleAttr(attributeName: string): boolean {
    if (_isString(attributeName)) {
        return attributeName.substring(0, 10) === '_ngcontent' || attributeName.substring(0, 7) === '_nghost'
    }
    return false
}

/*
 * Iterate through children of a target element looking for span tags
 * and return the text content of the span tags, separated by spaces,
 * along with the direct text content of the target element
 * @param {Element} target - element to check
 * @returns {string} text content of the target element and its child span tags
 */
export function getDirectAndNestedSpanText(target: Element): string {
    let text = getSafeText(target)
    text = `${text} ${getNestedSpanText(target)}`.trim()
    return shouldCaptureValue(text) ? text : ''
}

/*
 * Iterate through children of a target element looking for span tags
 * and return the text content of the span tags, separated by spaces
 * @param {Element} target - element to check
 * @returns {string} text content of span tags
 */
export function getNestedSpanText(target: Element): string {
    let text = ''
    if (target && target.childNodes && target.childNodes.length) {
        _each(target.childNodes, function (child) {
            if (child && child.tagName?.toLowerCase() === 'span') {
                try {
                    const spanText = getSafeText(child)
                    text = `${text} ${spanText}`.trim()

                    if (child.childNodes && child.childNodes.length) {
                        text = `${text} ${getNestedSpanText(child)}`.trim()
                    }
                } catch (e) {
                    logger.error(e)
                }
            }
        })
    }
    return text
}

/*
Back in the day storing events in Postgres we use Elements for autocapture events.
Now we're using elements_chain. We used to do this parsing/processing during ingestion.
This code is just copied over from ingestion, but we should optimize it
to create elements_chain string directly.
*/
export function getElementsChainString(elements: Properties[]): string {
    return elementsToString(extractElements(elements))
}

// This interface is called 'Element' in plugin-scaffold https://github.com/PostHog/plugin-scaffold/blob/b07d3b879796ecc7e22deb71bf627694ba05386b/src/types.ts#L200
// However 'Element' is a DOM Element when run in the browser, so we have to rename it
interface PHElement {
    text?: string
    tag_name?: string
    href?: string
    attr_id?: string
    attr_class?: string[]
    nth_child?: number
    nth_of_type?: number
    attributes?: Record<string, any>
    event_id?: number
    order?: number
    group_id?: number
}

function escapeQuotes(input: string): string {
    return input.replace(/"|\\"/g, '\\"')
}

function elementsToString(elements: PHElement[]): string {
    const ret = elements.map((element) => {
        let el_string = ''
        if (element.tag_name) {
            el_string += element.tag_name
        }
        if (element.attr_class) {
            element.attr_class.sort()
            for (const single_class of element.attr_class) {
                el_string += `.${single_class.replace(/"/g, '')}`
            }
        }
        const attributes: Record<string, any> = {
            ...(element.text ? { text: element.text } : {}),
            'nth-child': element.nth_child ?? 0,
            'nth-of-type': element.nth_of_type ?? 0,
            ...(element.href ? { href: element.href } : {}),
            ...(element.attr_id ? { attr_id: element.attr_id } : {}),
            ...element.attributes,
        }
        const sortedAttributes: Record<string, any> = {}
        _entries(attributes)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(
                ([key, value]) => (sortedAttributes[escapeQuotes(key.toString())] = escapeQuotes(value.toString()))
            )
        el_string += ':'
        el_string += _entries(attributes)
            .map(([key, value]) => `${key}="${value}"`)
            .join('')
        return el_string
    })
    return ret.join(';')
}

function extractElements(elements: Properties[]): PHElement[] {
    return elements.map((el) => {
        const response = {
            text: el['$el_text']?.slice(0, 400),
            tag_name: el['tag_name'],
            href: el['attr__href']?.slice(0, 2048),
            attr_class: extractAttrClass(el),
            attr_id: el['attr__id'],
            nth_child: el['nth_child'],
            nth_of_type: el['nth_of_type'],
            attributes: {} as { [id: string]: any },
        }
        _entries(el)
            .filter(([key]) => key.indexOf('attr__') === 0)
            .forEach(([key, value]) => (response.attributes[key] = value))
        return response
    })
}

function extractAttrClass(el: Properties): PHElement['attr_class'] {
    const attr_class = el['attr__class']
    if (!attr_class) {
        return undefined
    } else if (_isArray(attr_class)) {
        return attr_class
    } else {
        return attr_class.split(' ')
    }
}
