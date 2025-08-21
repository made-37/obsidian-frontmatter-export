import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import yaml from 'js-yaml';

/**
 * Mapping from source base names to target URLs.
 */
interface LinkTargets {
    [sourceBase: string]: string;
}

/**
 * Aborts execution with an error message.
 * @param msg - The error message to display.
 */
function abort(msg: string): never {
    console.error(msg);
    process.exit(1);
}

/**
 * Recursively collects all .html files in a directory.
 * @param dir - The directory to search.
 * @returns Array of absolute file paths to .html files.
 */
function getAllHtmlFiles(dir: string): string[] {
    let files: string[] = [];
    const dirEntries = fs.readdirSync(dir);
    for (const file of dirEntries) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            files = files.concat(getAllHtmlFiles(filePath));
        } else if (file.endsWith('.html')) {
            files.push(filePath.normalize());
        }
    }
    return files;
}

/**
 * Reads metadata.json and returns a mapping from source base names to target URLs.
 * @param folder - The root folder containing site-lib/metadata.json
 * @returns An object mapping source base names to target URLs.
 * @throws Will abort if metadata.json is missing or invalid.
 */
function getLinkTargets(folder: string): LinkTargets {
    const linkTargets: LinkTargets = {};
    const metadataPath = path.join(folder, 'site-lib', 'metadata.json');
    if (!fs.existsSync(metadataPath)) abort('site-lib/metadata.json not found.');
    try {
        const metadataRaw = fs.readFileSync(metadataPath, 'utf8');
        const metadata = JSON.parse(metadataRaw);
        for (const source in metadata.sourceToTarget) {
            const sourcePath = path.resolve(folder, source);
            const sourceBase = path.basename(sourcePath, sourcePath.endsWith('.md') ? '.md' : '');
            linkTargets[sourceBase] = metadata.sourceToTarget[source];
        }
    } catch (e) {
        abort('Could not parse metadata.json');
    }
    return linkTargets;
}

/**
 * Parses YAML frontmatter from a <pre> element and returns key-value pairs.
 * @param pre - The <pre> element containing YAML frontmatter.
 * @returns Array of [key, value] pairs from the frontmatter.
 */
function parseFrontmatter(pre: Element): [string, string | string[]][] {
    const text = pre.textContent || '';
    let parsed: Record<string, any> = {};
    try {
        parsed = yaml.load(text) as Record<string, any>;
    } catch (e) {
        console.error('YAML parse error:', e);
        return [];
    }
    return Object.entries(parsed ?? {});
}

/**
 * Creates an anchor (<a>) element with the given target and text.
 * @param document - The DOM document to create the element in.
 * @param target - The URL or link target.
 * @param text - The link text.
 * @param newWindow - Whether to open the link in a new window/tab.
 * @returns The created anchor element.
 */
function createLink(document: Document, target: string, text: string, newWindow: boolean = false): HTMLElement {
    const a = document.createElement('a');
    a.href = target;
    a.textContent = text;
    if (newWindow) {
        a.target = '_blank';
        a.rel = "noopener noreferrer"; 
    }
    return a;
}

/**
 * Creates an HTML element for a given frontmatter key-value pair.
 * Handles arrays, tags, external links, and wiki links.
 * @param key - The frontmatter key.
 * @param val - The value associated with the key.
 * @param document - The DOM document to create elements in.
 * @param linkTargets - Mapping of wiki link targets.
 * @returns The created HTML element.
 */
function createHtmlElement(key: string, val: any, document: Document, linkTargets: LinkTargets): HTMLElement | Text {
    // Resolve array values recursively and join results in a div
    if (Array.isArray(val)) {
        const elems = val.map(v => createHtmlElement(key, v, document, linkTargets));
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.flexWrap = 'wrap';
        div.style.gap = '0.5em';
        elems.forEach(elem => div.appendChild(elem));
        return div;
    }

    // Render unknown types just as text node
    if (typeof val !== 'string') return document.createTextNode(String(val));

    // Check for Tags.
    if (key === 'tags') {
        // obsidian-webpage-export uses <a class="tag is-unresolved" href="?query=tag:Hochzeit">#Hochzeit</a>
        const elem = createLink(document, `?query=tag:${val}`, `#${val}`, false);
        elem.className = 'tag is-unresolved';
        return elem;
    }
    
    // Check for absolute, external link
    if (/^https?:\/\//.test(val)) {
        return createLink(document, val, val, true);
    }
    
    // Check for [[wiki]] link
    const wikiMatch = val.match(/^\[\[(.+?)\]\]$/);
    if (wikiMatch) {
        const target = linkTargets[wikiMatch[1]];
        if (target) {
            return createLink(document, target, wikiMatch[1]);
        }
    }
    return document.createTextNode(val);
}

/**
 * Adds a properties table to the HTML file based on its frontmatter.
 * Updates the <h1> and document title if title is present in frontmatter.
 * @param file - The HTML file to process.
 * @param linkTargets - Mapping of wiki link targets.
 */
function addPropertiesTable(file: string, linkTargets: LinkTargets): void {
    const html = fs.readFileSync(file, 'utf8');
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const pre = document.querySelector('pre.frontmatter');
    if (!pre) return;
    const properties = parseFrontmatter(pre);
    if (properties?.length == 0) return;
    properties.unshift(['ID', (path.basename(file, '.html'))]);
    const h1 = document.querySelector('h1');
    if (!h1) return;
    const table = document.createElement('table');
    table.style.backgroundColor = 'var(--background-secondary-alt)';
    table.style.borderRadius = '4px';
    table.style.margin = '2em auto';
    table.style.width = '90%';
    table.style.overflow = 'hidden';
    for (const [key, value] of properties) {
        if (value === undefined || value === null || value === '') continue;
        if (key === 'title' || key === 'Title' || key === 'Titel') {
            h1.textContent = value as string;
            document.title = value as string;
        }
        const tr = document.createElement('tr');
        const tdKey = document.createElement('td');
        tdKey.textContent = key;
        tdKey.style.fontWeight = 'lighter';
        tdKey.style.whiteSpace = 'nowrap';
        tdKey.style.fontSize = '0.9rem';
        const tdValue = document.createElement('td');
        tdValue.style.fontSize = '0.9rem';
        tdValue.appendChild(createHtmlElement(key, value, document, linkTargets));
        tr.appendChild(tdKey);
        tr.appendChild(tdValue);
        table.appendChild(tr);
    }
    h1.parentNode?.insertBefore(table, h1.nextSibling);

    // The plugin already renders tags in an own section. Hide this one as we already have the tags covered in the table.
    const dataBar = document.querySelector('div.data-bar');
    if (dataBar) {
        dataBar.style.visibility = 'hidden';
    }
    fs.writeFileSync(file, dom.serialize(), 'utf8');
}

function main() {
    const folder = process.argv[2];
    if (!folder) abort('No folder parameter provided.');
    if (!fs.existsSync(folder)) abort('Folder does not exist.');
    if (!fs.statSync(folder).isDirectory()) abort('Parameter is not a folder.');

    // Read metadata.json - we need this to later resolve [[links]] in the frontmatter
    const linkTargets = getLinkTargets(folder);
    const htmlFiles = getAllHtmlFiles(folder);
    for (const file of htmlFiles) {
        console.log(`    Processing: ${file}`);
        addPropertiesTable(file, linkTargets);
    }
}

main();
