# Codex 浏览器扩展 API 参考

**来源文件**：`C:\Users\15466\.codex\plugins\cache\openai-bundled\chrome\latest\docs\api.json`

**文档性质**：本文档由上述机器可读 API 描述文件（JSON）直接导出，描述的是 Codex 浏览器扩展（OpenAI Codex browser extension）对外暴露的 API 面（API surface）。所有 TypeScript 声明均为原文字面照录，未改写、未省略、未意译，声明顺序与源文件一致。本文档为纯参考文档，不包含任何解读、评价或建议。

## 统计

| 项目 | 数量 |
| --- | --- |
| 顶层根键 `root` | `Agent` |
| `interfaces` 接口数 | 22 |
| `types` 类型数 | 67 |
| 接口成员总数 | 147 |
| 接口声明条数（各成员 `declarations[]` 之和） | 152 |
| 类型声明条数（各类型 `text`） | 67 |
| **声明总条数** | **219** |

## 标注图例

下列标注逐字对应源数据中的原始字段，正文中仅在字段存在且有意义时出现：

- `> 默认不支持: <列表>` — 对应成员上的 `unsupportedByDefaultIn` 字段，表示该成员在这些浏览器类型下默认不支持。
- `> documented: <值>` — 对应成员上的 `documented` 字段。
- `> 引用: <列表>` — 对应单条声明上的 `references` 字段（为空数组时省略）。
- 同一成员下出现多个连续的 ts 代码块，表示源数据中该成员有多条 `declarations`（重载），按原始顺序全部列出。

## 目录

**接口**

- [`Agent`](#agent) — 2 个成员
- [`Browsers`](#browsers) — 4 个成员
- [`Browser`](#browser) — 7 个成员
- [`BrowserUser`](#browseruser) — 3 个成员
- [`Tabs`](#tabs) — 5 个成员
- [`Tab`](#tab) — 21 个成员
- [`AXAPI`](#axapi) — 11 个成员
- [`ContentAPI`](#contentapi) — 3 个成员
- [`CUAAPI`](#cuaapi) — 8 个成员
- [`DomCUAAPI`](#domcuaapi) — 7 个成员
- [`PlaywrightAPI`](#playwrightapi) — 16 个成员
- [`PlaywrightFrameLocator`](#playwrightframelocator) — 7 个成员
- [`PlaywrightLocator`](#playwrightlocator) — 34 个成员
- [`PlaywrightDownload`](#playwrightdownload) — 1 个成员
- [`PlaywrightFileChooser`](#playwrightfilechooser) — 2 个成员
- [`TabClipboardAPI`](#tabclipboardapi) — 4 个成员
- [`TabDevAPI`](#tabdevapi) — 1 个成员
- [`AlertDialog`](#alertdialog) — 2 个成员
- [`BeforeUnloadDialog`](#beforeunloaddialog) — 2 个成员
- [`ConfirmDialog`](#confirmdialog) — 3 个成员
- [`Documentation`](#documentation) — 1 个成员
- [`PromptDialog`](#promptdialog) — 3 个成员

**类型**

- [全部类型](#类型) — 67 个

---

## 接口

### Agent

#### `browsers`

```ts
browsers: Browsers; // API for finding and selecting browsers.
```

> 引用: `Browsers`

#### `documentation`

```ts
documentation: Documentation; // API for reading packaged browser-use documentation by name.
```

> 引用: `Documentation`
> 默认不支持: `mcpapps`

### Browsers

#### `get`

```ts
get(id: string): Promise<Browser>; // Get a browser by id or client type.
```

> 引用: `Browser`

#### `getDefault`

```ts
getDefault(): Promise<Browser>; // Get the default browser from those currently available.
```

> 引用: `Browser`
> 默认不支持: `mcpapps`
> documented: false

#### `getForUrl`

```ts
getForUrl(url: string): Promise<Browser>; // Get the browser best suited to interact with the provided URL.
```

> 引用: `Browser`
> 默认不支持: `mcpapps`
> documented: false

#### `list`

```ts
list(): Promise<Array<{ family?: string; id: string; metadata?: { codexSessionId?: string; extensionInstanceId?: string }; name: string; profileName?: string; type: "iab" | "extension" | "cdp" | "mcpapps" }>>; // List available browsers.
```

### Browser

#### `browserId`

```ts
browserId: string; // Browser id selected by `agent.browsers.get()`.
```

> 默认不支持: `mcpapps`

#### `capabilities`

```ts
capabilities: BrowserCapabilityCollection; // Browser-scoped optional capabilities advertised by the connected backend; discover IDs with `await browser.capabilities.list()`, then call `await (await browser.capabilities.get(id)).documentation()` for method details.
```

> 引用: `BrowserCapabilityCollection`
> 默认不支持: `mcpapps`

#### `tabs`

```ts
tabs: Tabs; // API for interacting with browser tabs.
```

> 引用: `Tabs`

#### `user`

```ts
user: BrowserUser; // Context for user-owned browser tabs.
```

> 引用: `BrowserUser`
> 默认不支持: `iab`, `cdp`, `mcpapps`

#### `documentation`

```ts
documentation(): Promise<string>; // Read browser guidance and the core API reference.
```

#### `history`

```ts
history(options: BrowserHistoryOptions): Promise<Array<BrowserHistoryEntry>>; // List recent browsing history ordered by `dateVisited` descending.
```

> 引用: `BrowserHistoryOptions`, `BrowserHistoryEntry`
> 默认不支持: `iab`, `cdp`, `mcpapps`

#### `nameSession`

```ts
nameSession(name: string): Promise<void>; // Name the current browser automation session.
```

> 默认不支持: `mcpapps`

### BrowserUser

#### `claimTab`

```ts
claimTab(tab: string | BrowserUserTabInfo): Promise<Tab>; // Claim a user tab returned by `openTabs()` and return it as a controllable agent tab.
```

> 引用: `BrowserUserTabInfo`, `Tab`
> 默认不支持: `mcpapps`

#### `getTabContext`

```ts
getTabContext(tab: string | BrowserUserTabInfo): Promise<BrowserUserTabContext>; // Read bounded page context from an open user tab without claiming it.
```

> 引用: `BrowserUserTabInfo`, `BrowserUserTabContext`
> 默认不支持: `extension`, `iab`, `cdp`, `mcpapps`
> documented: false

#### `openTabs`

```ts
openTabs(): Promise<Array<BrowserUserTabInfo>>; // List open top-level tabs across the user's browser windows ordered by `lastOpened` descending.
```

> 引用: `BrowserUserTabInfo`
> 默认不支持: `mcpapps`

### Tabs

#### `content`

```ts
content(options: TabsContentOptions): Promise<Array<TabsContentResult>>; // Load one or more URLs in temporary background tabs and extract their content without changing the selected tab.
```

> 引用: `TabsContentOptions`, `TabsContentResult`
> 默认不支持: `iab`, `extension`, `cdp`, `mcpapps`

#### `get`

```ts
get(id: string): Promise<Tab>; // Get a tab by id.
```

> 引用: `Tab`

#### `list`

```ts
list(): Promise<Array<TabInfo>>; // List open tabs in the browser.
```

> 引用: `TabInfo`

#### `new`

```ts
new(): Promise<Tab>; // Create and return a new tab in the browser.
```

> 引用: `Tab`
> 默认不支持: `mcpapps`

#### `selected`

```ts
selected(): Promise<undefined | Tab>; // Return the currently selected tab, if any.
```

> 引用: `Tab`
> 默认不支持: `mcpapps`

### Tab

#### `ax`

```ts
ax: AXAPI; // API for interacting with accessibility state and accessibility elements.
```

> 引用: `AXAPI`
> 默认不支持: `iab`, `extension`, `cdp`, `mcpapps`

#### `capabilities`

```ts
capabilities: TabCapabilityCollection; // Tab-scoped optional capabilities advertised by the connected backend; discover IDs with `await tab.capabilities.list()`, then call `await (await tab.capabilities.get(id)).documentation()` for method details.
```

> 引用: `TabCapabilityCollection`
> 默认不支持: `mcpapps`

#### `clipboard`

```ts
clipboard: TabClipboardAPI; // API for interacting with the browser session's clipboard.
```

> 引用: `TabClipboardAPI`
> 默认不支持: `mcpapps`

#### `content`

```ts
content: ContentAPI; // API for exporting tab content.
```

> 引用: `ContentAPI`
> 默认不支持: `mcpapps`

#### `cua`

```ts
cua: CUAAPI; // API for interacting with the tab via the cua api
```

> 引用: `CUAAPI`
> 默认不支持: `mcpapps`

#### `dev`

```ts
dev: TabDevAPI; // API for developer-oriented tab inspection.
```

> 引用: `TabDevAPI`
> 默认不支持: `mcpapps`

#### `dom_cua`

```ts
dom_cua: DomCUAAPI; // API for interacting with the tab via the dom based cua api
```

> 引用: `DomCUAAPI`
> 默认不支持: `mcpapps`

#### `id`

```ts
id: string; // A tab's unique identifier
```

#### `playwright`

```ts
playwright: PlaywrightAPI; // API for interacting with the tab via the playwright api
```

> 引用: `PlaywrightAPI`

#### `back`

```ts
back(): Promise<void>; // Navigate this tab back in history.
```

> 默认不支持: `mcpapps`

#### `close`

```ts
close(): Promise<void>; // Close this tab.
```

> 默认不支持: `mcpapps`

#### `forward`

```ts
forward(): Promise<void>; // Navigate this tab forward in history.
```

> 默认不支持: `mcpapps`

#### `getJsDialog`

```ts
getJsDialog(): Promise<undefined | Dialog>; // Get the active JavaScript dialog for this tab, if one is currently open.
```

> 引用: `Dialog`
> 默认不支持: `mcpapps`

#### `goto`

```ts
goto(url: string): Promise<void>; // Open a URL in this tab.
```

> 默认不支持: `mcpapps`

#### `markDeliverable`

```ts
markDeliverable(): Promise<void>; // Keep this tab as a deliverable after the turn completes.
```

> 默认不支持: `cdp`, `mcpapps`

#### `markHandoff`

```ts
markHandoff(): Promise<void>; // Keep this tab available for a later turn after the current turn completes.
```

> 默认不支持: `cdp`, `mcpapps`

#### `reload`

```ts
reload(): Promise<void>; // Reload this tab.
```

> 默认不支持: `mcpapps`

#### `requestManualHandoff`

```ts
requestManualHandoff(): Promise<void>; // Request manual user control of this Cloud Browser tab and mark it for handoff.
```

> 默认不支持: `extension`, `iab`, `cdp`, `mcpapps`

#### `screenshot`

```ts
screenshot(options: ScreenshotOptions): Promise<Uint8Array>; // Capture a screenshot of this tab.
```

> 引用: `ScreenshotOptions`

#### `title`

```ts
title(): Promise<undefined | string>; // Get the current title for this tab.
```

#### `url`

```ts
url(): Promise<undefined | string>; // Get the current URL for this tab.
```

### AXAPI

#### `click`

```ts
click(target: number | AXPoint, options?: AXClickOptions): Promise<void>; // Click an accessibility element or viewport coordinate.
```

> 引用: `AXPoint`, `AXClickOptions`
> 默认不支持: `mcpapps`

#### `drag`

```ts
drag(from: AXPoint, to: AXPoint): Promise<void>; // Drag between two viewport coordinates.
```

> 引用: `AXPoint`
> 默认不支持: `mcpapps`

#### `get`

```ts
get(mode?: "state", options?: AXStateOptions): Promise<string>; // Return accessibility state without displaying it; prefer write() for model-visible observation.
```

> 引用: `AXStateOptions`

```ts
get(mode: "screenshot"): Promise<Uint8Array>; // Return screenshot bytes without displaying an image or advancing accessibility state.
```

```ts
get(mode: "both", options?: AXStateOptions): Promise<{ screenshot?: Uint8Array; state: string }>; // Return accessibility state and screenshot bytes when available.
```

> 引用: `AXStateOptions`
> 默认不支持: `mcpapps`

#### `paste`

```ts
paste(elementIndex: null | number, text: string, options?: AXPasteOptions): Promise<void>; // Paste through the browser session's virtual clipboard; null uses current focus.
```

> 引用: `AXPasteOptions`
> 默认不支持: `mcpapps`

#### `performSecondaryAction`

```ts
performSecondaryAction(elementIndex: number, action: string): Promise<void>; // Invoke an additional action exposed by an accessibility element.
```

> 默认不支持: `mcpapps`

#### `pressKey`

```ts
pressKey(elementIndex: null | number, key: string, options?: AXPressKeyOptions): Promise<void>; // If elementIndex is specified, attempt to focus the element prior to key entry.
```

> 引用: `AXPressKeyOptions`
> 默认不支持: `mcpapps`

#### `scroll`

```ts
scroll(target: number | AXPoint, direction: AXDirection, pages?: number): Promise<void>; // Scroll an accessibility element or a viewport coordinate.
```

> 引用: `AXPoint`, `AXDirection`
> 默认不支持: `mcpapps`

#### `selectText`

```ts
selectText(elementIndex: number, text: string, options?: AXSelectTextOptions): Promise<void>; // Select text or position the cursor within an editable element.
```

> 引用: `AXSelectTextOptions`
> 默认不支持: `mcpapps`

#### `setValue`

```ts
setValue(elementIndex: number, value: string): Promise<void>; // Set the value of an accessibility element.
```

> 默认不支持: `mcpapps`

#### `typeText`

```ts
typeText(elementIndex: null | number, text: string): Promise<void>; // If elementIndex is specified, attempt to focus the element prior to text entry.
```

> 默认不支持: `mcpapps`

#### `write`

```ts
write(mode?: "state", options?: AXStateOptions): Promise<void>; // Prefer this method to display current accessibility state to the model.
```

> 引用: `AXStateOptions`

```ts
write(mode: "screenshot"): Promise<void>; // Display a screenshot without advancing accessibility state.
```

```ts
write(mode: "both", options?: AXStateOptions): Promise<void>; // Display accessibility state followed by its corresponding screenshot.
```

> 引用: `AXStateOptions`
> 默认不支持: `mcpapps`

### ContentAPI

#### `export`

```ts
export(): Promise<string>; // Export the tab's content to a file on disk using the default asset-loader path.
```

> 默认不支持: `iab`, `extension`, `cdp`, `mcpapps`

#### `exportGsuite`

```ts
exportGsuite(type: "pdf" | "md" | "xlsx" | "csv" | "docx" | "pptx"): Promise<string>; // Export a Google Workspace tab using an explicit GSuite export type.
```

> 默认不支持: `mcpapps`

#### `exportYouTubeTranscript`

```ts
exportYouTubeTranscript(): Promise<string>; // Export an HTTPS youtube.com or www.youtube.com /watch transcript to a UTF-8 .txt file.
```

> 默认不支持: `mcpapps`

### CUAAPI

#### `click`

```ts
click(options: ClickOptions): Promise<void>; // Click at a coordinate in the current viewport.
```

> 引用: `ClickOptions`
> 默认不支持: `mcpapps`

#### `double_click`

```ts
double_click(options: DoubleClickOptions): Promise<void>; // Double click at a coordinate in the current viewport.
```

> 引用: `DoubleClickOptions`
> 默认不支持: `mcpapps`

#### `downloadMedia`

```ts
downloadMedia(options: CuaDownloadMediaOptions): Promise<void>; // Trigger a media download at a viewport coordinate.
```

> 引用: `CuaDownloadMediaOptions`
> 默认不支持: `iab`, `mcpapps`
> documented: false

#### `drag`

```ts
drag(options: DragOptions): Promise<void>; // Drag from a point to a point by the provided path.
```

> 引用: `DragOptions`
> 默认不支持: `mcpapps`

#### `keypress`

```ts
keypress(options: KeypressOptions): Promise<void>; // Press control characters at the current focused element (focus it first via click/dblclick).
```

> 引用: `KeypressOptions`
> 默认不支持: `mcpapps`

#### `move`

```ts
move(options: MoveOptions): Promise<void>; // Move the mouse to a point by the provided x and y coordinates.
```

> 引用: `MoveOptions`
> 默认不支持: `mcpapps`

#### `scroll`

```ts
scroll(options: ScrollOptions): Promise<void>; // Scroll by a delta from a specific viewport coordinate.
```

> 引用: `ScrollOptions`
> 默认不支持: `mcpapps`

#### `type`

```ts
type(options: TypeOptions): Promise<void>; // Type text at the current focus.
```

> 引用: `TypeOptions`
> 默认不支持: `mcpapps`

### DomCUAAPI

#### `click`

```ts
click(options: DomClickOptions): Promise<void>; // Click a DOM node by its id from the visible DOM snapshot.
```

> 引用: `DomClickOptions`
> 默认不支持: `mcpapps`

#### `double_click`

```ts
double_click(options: DomClickOptions): Promise<void>; // Double-click a DOM node by its id.
```

> 引用: `DomClickOptions`
> 默认不支持: `mcpapps`

#### `downloadMedia`

```ts
downloadMedia(options: DomDownloadMediaOptions): Promise<void>; // Trigger a media download for a DOM node.
```

> 引用: `DomDownloadMediaOptions`
> 默认不支持: `iab`, `mcpapps`
> documented: false

#### `get_visible_dom`

```ts
get_visible_dom(): Promise<unknown>; // Return a filtered DOM with node ids for interactable elements.
```

> 默认不支持: `mcpapps`

#### `keypress`

```ts
keypress(options: DomKeypressOptions): Promise<void>; // Press control characters at the currently focused element (focus it first via click/dblclick).
```

> 引用: `DomKeypressOptions`
> 默认不支持: `mcpapps`

#### `scroll`

```ts
scroll(options: DomScrollOptions): Promise<void>; // Scroll either the page or a specific node (if node_id provided) by deltas.
```

> 引用: `DomScrollOptions`
> 默认不支持: `mcpapps`

#### `type`

```ts
type(options: DomTypeOptions): Promise<void>; // Type text into the currently focused element (focus via click first).
```

> 引用: `DomTypeOptions`
> 默认不支持: `mcpapps`

### PlaywrightAPI

#### `domSnapshot`

```ts
domSnapshot(): Promise<string>; // Return a snapshot of the current DOM as a string, including expanded iframe body content when available.
```

#### `elementInfo`

```ts
elementInfo(options: ElementInfoOptions): Promise<Array<ElementInfo>>; // Return locator-oriented metadata for elements at a screenshot coordinate.
```

> 引用: `ElementInfoOptions`, `ElementInfo`
> 默认不支持: `mcpapps`
> documented: false

#### `elementScreenshot`

```ts
elementScreenshot(options: ElementScreenshotOptions): Promise<Uint8Array>; // Capture a screenshot of the current viewport annotated with matching element bounds and the probed point.
```

> 引用: `ElementScreenshotOptions`
> 默认不支持: `mcpapps`
> documented: false

#### `evaluate`

```ts
evaluate<TResult, TArg>(pageFunction: PlaywrightEvaluateFunction<TArg, TResult>, arg?: TArg, options?: PlaywrightEvaluateOptions): Promise<TResult>; // Evaluate JavaScript in a read-only page scope.
```

> 引用: `PlaywrightEvaluateFunction`, `PlaywrightEvaluateOptions`

#### `expectNavigation`

```ts
expectNavigation<T>(action: () => Promise<T>, options: { timeoutMs?: number; url?: string; waitUntil?: LoadState }): Promise<T>; // Expect a navigation triggered by an action.
```

> 引用: `LoadState`
> 默认不支持: `mcpapps`

#### `frameLocator`

```ts
frameLocator(frameSelector: string): PlaywrightFrameLocator; // Create a frame-scoped locator builder.
```

> 引用: `PlaywrightFrameLocator`

#### `getByLabel`

```ts
getByLabel(text: TextMatcher, options: { exact?: boolean }): PlaywrightLocator; // Find elements by label text within the page.
```

> 引用: `TextMatcher`, `PlaywrightLocator`

#### `getByPlaceholder`

```ts
getByPlaceholder(text: TextMatcher, options: { exact?: boolean }): PlaywrightLocator; // Find elements by placeholder text within the page.
```

> 引用: `TextMatcher`, `PlaywrightLocator`

#### `getByRole`

```ts
getByRole(role: string, options: { exact?: boolean; name?: TextMatcher }): PlaywrightLocator; // Find elements by ARIA role within the page.
```

> 引用: `TextMatcher`, `PlaywrightLocator`

#### `getByTestId`

```ts
getByTestId(testId: string): PlaywrightLocator; // Find elements by test id within the page.
```

> 引用: `PlaywrightLocator`

#### `getByText`

```ts
getByText(text: TextMatcher, options: { exact?: boolean }): PlaywrightLocator; // Find elements by text within the page.
```

> 引用: `TextMatcher`, `PlaywrightLocator`

#### `locator`

```ts
locator(selector: string): PlaywrightLocator; // Create a locator scoped to this tab.
```

> 引用: `PlaywrightLocator`

#### `waitForEvent`

```ts
waitForEvent(event: "download", options?: WaitForEventOptions): Promise<PlaywrightDownload>; // Wait for the next download to complete; call before clicking its download control.
```

> 引用: `WaitForEventOptions`, `PlaywrightDownload`

```ts
waitForEvent(event: "filechooser", options?: WaitForEventOptions): Promise<PlaywrightFileChooser>; // Wait for a file chooser.
```

> 引用: `WaitForEventOptions`, `PlaywrightFileChooser`
> 默认不支持: `mcpapps`

#### `waitForLoadState`

```ts
waitForLoadState(options: PageWaitForLoadStateOptions): Promise<void>; // Wait for the page to reach a specific load state.
```

> 引用: `PageWaitForLoadStateOptions`
> 默认不支持: `mcpapps`

#### `waitForTimeout`

```ts
waitForTimeout(timeoutMs: number): Promise<void>; // Wait for a fixed duration.
```

> 默认不支持: `mcpapps`

#### `waitForURL`

```ts
waitForURL(url: string, options: PageWaitForURLOptions): Promise<void>; // Wait for the page URL to match the provided value.
```

> 引用: `PageWaitForURLOptions`
> 默认不支持: `mcpapps`

### PlaywrightFrameLocator

#### `frameLocator`

```ts
frameLocator(frameSelector: string): PlaywrightFrameLocator; // Create a locator scoped to a nested frame.
```

> 引用: `PlaywrightFrameLocator`

#### `getByLabel`

```ts
getByLabel(text: TextMatcher, options: { exact?: boolean }): PlaywrightLocator; // Find elements by label within this frame.
```

> 引用: `TextMatcher`, `PlaywrightLocator`

#### `getByPlaceholder`

```ts
getByPlaceholder(text: TextMatcher, options: { exact?: boolean }): PlaywrightLocator; // Find elements by placeholder within this frame.
```

> 引用: `TextMatcher`, `PlaywrightLocator`

#### `getByRole`

```ts
getByRole(role: string, options: { exact?: boolean; name?: TextMatcher }): PlaywrightLocator; // Find elements by ARIA role within this frame.
```

> 引用: `TextMatcher`, `PlaywrightLocator`

#### `getByTestId`

```ts
getByTestId(testId: string): PlaywrightLocator; // Find elements by test id within this frame.
```

> 引用: `PlaywrightLocator`

#### `getByText`

```ts
getByText(text: TextMatcher, options: { exact?: boolean }): PlaywrightLocator; // Find elements by text within this frame.
```

> 引用: `TextMatcher`, `PlaywrightLocator`

#### `locator`

```ts
locator(selector: string): PlaywrightLocator; // Create a locator scoped to this frame.
```

> 引用: `PlaywrightLocator`

### PlaywrightLocator

#### `all`

```ts
all(): Promise<Array<PlaywrightLocator>>; // Resolve to a list of locators for each matched element.
```

> 引用: `PlaywrightLocator`

#### `allTextContents`

```ts
allTextContents(options: { timeoutMs?: number }): Promise<Array<string>>; // Return `textContent` for *all* elements matched by this locator.
```

#### `and`

```ts
and(locator: PlaywrightLocator): PlaywrightLocator; // Return a locator matching elements that satisfy both this locator and `locator`.
```

> 引用: `PlaywrightLocator`

#### `check`

```ts
check(options: LocatorCheckOptions): Promise<void>; // Check a checkbox or switch-like control.
```

> 引用: `LocatorCheckOptions`

#### `click`

```ts
click(options: LocatorClickOptions): Promise<void>; // Click the element matched by this locator.
```

> 引用: `LocatorClickOptions`

#### `count`

```ts
count(): Promise<number>; // Number of elements matching this locator.
```

#### `dblclick`

```ts
dblclick(options: LocatorClickOptions): Promise<void>; // Double-click the element matched by this locator.
```

> 引用: `LocatorClickOptions`
> 默认不支持: `mcpapps`

#### `downloadMedia`

```ts
downloadMedia(options: LocatorDownloadMediaOptions): Promise<string>; // Download the matched media or file link and return its saved file path.
```

> 引用: `LocatorDownloadMediaOptions`
> 默认不支持: `mcpapps`

#### `evaluate`

```ts
evaluate<TResult, TArg>(pageFunction: LocatorEvaluateFunction<TArg, TResult>, arg?: TArg, options?: PlaywrightEvaluateOptions): Promise<TResult>; // Evaluate JavaScript in a read-only scope; the locator must resolve unambiguously to one element.
```

> 引用: `LocatorEvaluateFunction`, `PlaywrightEvaluateOptions`

#### `evaluateAll`

```ts
evaluateAll<TResult, TArg>(pageFunction: LocatorEvaluateAllFunction<TArg, TResult>, arg?: TArg, options?: PlaywrightEvaluateOptions): Promise<TResult>; // Evaluate read-only JavaScript against all elements matched by this locator.
```

> 引用: `LocatorEvaluateAllFunction`, `PlaywrightEvaluateOptions`

#### `fill`

```ts
fill(value: string, options: { timeoutMs?: number }): Promise<void>; // Replace the element's value with the provided text.
```

#### `filter`

```ts
filter(options: LocatorFilterOptions): PlaywrightLocator; // Narrow this locator by additional constraints.
```

> 引用: `LocatorFilterOptions`, `PlaywrightLocator`

#### `first`

```ts
first(): PlaywrightLocator; // Return a locator pointing at the first matched element.
```

> 引用: `PlaywrightLocator`

#### `getAttribute`

```ts
getAttribute(name: string, options: { timeoutMs?: number }): Promise<null | string>; // Return an attribute value from the first matched element.
```

#### `getByLabel`

```ts
getByLabel(text: TextMatcher, options: { exact?: boolean }): PlaywrightLocator; // Find elements by label text, scoped to this locator.
```

> 引用: `TextMatcher`, `PlaywrightLocator`

#### `getByPlaceholder`

```ts
getByPlaceholder(text: TextMatcher, options: { exact?: boolean }): PlaywrightLocator; // Find elements by placeholder text, scoped to this locator.
```

> 引用: `TextMatcher`, `PlaywrightLocator`

#### `getByRole`

```ts
getByRole(role: string, options: { exact?: boolean; name?: TextMatcher }): PlaywrightLocator; // Find elements by ARIA role, scoped to this locator.
```

> 引用: `TextMatcher`, `PlaywrightLocator`

#### `getByTestId`

```ts
getByTestId(testId: string): PlaywrightLocator; // Find elements by test id, scoped to this locator.
```

> 引用: `PlaywrightLocator`

#### `getByText`

```ts
getByText(text: TextMatcher, options: { exact?: boolean }): PlaywrightLocator; // Find elements by text content, scoped to this locator.
```

> 引用: `TextMatcher`, `PlaywrightLocator`

#### `innerText`

```ts
innerText(options: { timeoutMs?: number }): Promise<string>; // Return the rendered (visible) text of the first matched element.
```

#### `isEnabled`

```ts
isEnabled(): Promise<boolean>; // Whether the first matched element is currently enabled.
```

#### `isVisible`

```ts
isVisible(): Promise<boolean>; // Whether the first matched element is currently visible.
```

#### `last`

```ts
last(): PlaywrightLocator; // Return a locator pointing at the last matched element.
```

> 引用: `PlaywrightLocator`

#### `locator`

```ts
locator(selector: string, options: LocatorLocatorOptions): PlaywrightLocator; // Create a descendant locator scoped to this locator.
```

> 引用: `LocatorLocatorOptions`, `PlaywrightLocator`

#### `nth`

```ts
nth(index: number): PlaywrightLocator; // Return a locator pointing at the Nth matched element.
```

> 引用: `PlaywrightLocator`

#### `or`

```ts
or(locator: PlaywrightLocator): PlaywrightLocator; // Return a locator matching elements that satisfy either this locator or `locator`.
```

> 引用: `PlaywrightLocator`

#### `press`

```ts
press(value: string, options: { timeoutMs?: number }): Promise<void>; // Press a keyboard key while this locator is focused.
```

> 默认不支持: `mcpapps`

#### `pressSequentially`

```ts
pressSequentially(value: string, options: LocatorPressSequentiallyOptions): Promise<void>; // Focus the element and press each character in the text sequentially without clearing its existing value.
```

> 引用: `LocatorPressSequentiallyOptions`
> 默认不支持: `mcpapps`

#### `selectOption`

```ts
selectOption(value: SelectOptionInput | Array<SelectOptionInput>, options: { timeoutMs?: number }): Promise<void>; // Select one or more options on a native `<select>` element.
```

> 引用: `SelectOptionInput`

#### `setChecked`

```ts
setChecked(checked: boolean, options: LocatorCheckOptions): Promise<void>; // Set a checkbox or switch-like control to a checked/unchecked state.
```

> 引用: `LocatorCheckOptions`

#### `textContent`

```ts
textContent(options: { timeoutMs?: number }): Promise<null | string>; // Return the raw textContent of the first matched element (or null if missing).
```

#### `type`

```ts
type(value: string, options: { timeoutMs?: number }): Promise<void>; // Type text into the element without clearing existing content.
```

#### `uncheck`

```ts
uncheck(options: LocatorCheckOptions): Promise<void>; // Uncheck a checkbox or switch-like control.
```

> 引用: `LocatorCheckOptions`

#### `waitFor`

```ts
waitFor(options: LocatorWaitForOptions): Promise<void>; // Wait for the element to reach a specific state.
```

> 引用: `LocatorWaitForOptions`

### PlaywrightDownload

#### `path`

```ts
path(options: { timeoutMs?: number }): Promise<null | string>; // Return the local path to the downloaded file, if available.
```

> 默认不支持: `mcpapps`

### PlaywrightFileChooser

#### `isMultiple`

```ts
isMultiple(): boolean; // Whether the input allows selecting multiple files.
```

> 默认不支持: `mcpapps`

#### `setFiles`

```ts
setFiles(files: FileChooserFiles, options: { timeoutMs?: number }): Promise<void>; // Set the files for this chooser using absolute paths visible to the browser.
```

> 引用: `FileChooserFiles`
> 默认不支持: `mcpapps`

### TabClipboardAPI

#### `read`

```ts
read(): Promise<Array<TabClipboardItem>>; // Read clipboard items, including text and binary payloads.
```

> 引用: `TabClipboardItem`
> 默认不支持: `mcpapps`

#### `readText`

```ts
readText(): Promise<string>; // Read plain text from the browser clipboard.
```

> 默认不支持: `mcpapps`

#### `write`

```ts
write(items: Array<TabClipboardItem>): Promise<void>; // Write clipboard items.
```

> 引用: `TabClipboardItem`
> 默认不支持: `mcpapps`

#### `writeText`

```ts
writeText(text: string): Promise<void>; // Write plain text to the browser clipboard.
```

> 默认不支持: `mcpapps`

### TabDevAPI

#### `logs`

```ts
logs(options: TabDevLogsOptions): Promise<Array<TabDevLogEntry>>; // Read console log messages captured for this tab.
```

> 引用: `TabDevLogsOptions`, `TabDevLogEntry`
> 默认不支持: `mcpapps`

### AlertDialog

#### `type`

```ts
type: "alert";
```

> 默认不支持: `mcpapps`

#### `dismiss`

```ts
dismiss(): Promise<void>;
```

> 默认不支持: `mcpapps`

### BeforeUnloadDialog

#### `type`

```ts
type: "beforeunload";
```

> 默认不支持: `mcpapps`

#### `dismiss`

```ts
dismiss(): Promise<void>;
```

> 默认不支持: `mcpapps`

### ConfirmDialog

#### `type`

```ts
type: "confirm";
```

> 默认不支持: `mcpapps`

#### `accept`

```ts
accept(): Promise<void>;
```

> 默认不支持: `mcpapps`

#### `dismiss`

```ts
dismiss(): Promise<void>;
```

> 默认不支持: `mcpapps`

### Documentation

#### `get`

```ts
get(name: string): Promise<string>; // Read packaged documentation by its extensionless relative path.
```

> 默认不支持: `mcpapps`

### PromptDialog

#### `type`

```ts
type: "prompt";
```

> 默认不支持: `mcpapps`

#### `accept`

```ts
accept(text: string): Promise<void>;
```

> 默认不支持: `mcpapps`

#### `dismiss`

```ts
dismiss(): Promise<void>;
```

> 默认不支持: `mcpapps`

---

## 类型

本节列出全部 `types`，共 67 个，声明原文照录。

**类型索引**：`BrowserCapabilityCollection`、`BrowserHistoryOptions`、`BrowserHistoryEntry`、`BrowserUserTabInfo`、`BrowserUserTabContext`、`TabsContentOptions`、`TabsContentResult`、`TabInfo`、`TabCapabilityCollection`、`Dialog`、`ScreenshotOptions`、`AXPoint`、`AXClickOptions`、`AXStateOptions`、`AXPasteOptions`、`AXPressKeyOptions`、`AXDirection`、`AXSelectTextOptions`、`ClickOptions`、`DoubleClickOptions`、`CuaDownloadMediaOptions`、`DragOptions`、`KeypressOptions`、`MoveOptions`、`ScrollOptions`、`TypeOptions`、`DomClickOptions`、`DomDownloadMediaOptions`、`DomKeypressOptions`、`DomScrollOptions`、`DomTypeOptions`、`ElementInfoOptions`、`ElementInfo`、`ElementScreenshotOptions`、`PlaywrightEvaluateFunction`、`PlaywrightEvaluateOptions`、`LoadState`、`TextMatcher`、`WaitForEventOptions`、`PageWaitForLoadStateOptions`、`PageWaitForURLOptions`、`LocatorCheckOptions`、`LocatorClickOptions`、`LocatorDownloadMediaOptions`、`LocatorEvaluateFunction`、`LocatorEvaluateAllFunction`、`LocatorFilterOptions`、`LocatorLocatorOptions`、`LocatorPressSequentiallyOptions`、`SelectOptionInput`、`LocatorWaitForOptions`、`FileChooserFiles`、`TabClipboardItem`、`TabDevLogsOptions`、`TabDevLogEntry`、`TabsContentType`、`ClipRect`、`AXMouseButton`、`AXSelectionType`、`ElementInfoRect`、`ElementInfoSelector`、`WaitUntil`、`MouseButton`、`KeyboardModifier`、`SelectOptionDescriptor`、`WaitForState`、`TabClipboardEntry`

### `BrowserCapabilityCollection`

```ts
type BrowserCapabilityCollection = {
  get(id: string): Promise<unknown>;
  list(): Promise<Array<{ id: string; description: string }>>;
};
```

### `BrowserHistoryOptions`

```ts
interface BrowserHistoryOptions {
  from?: string | Date; // Lower bound for visit timestamps.
  limit?: number; // Maximum number of history entries to return.
  queries?: Array<string>; // Optional terms to filter browser history with.
  to?: string | Date; // Upper bound for visit timestamps.
}
```

### `BrowserHistoryEntry`

```ts
interface BrowserHistoryEntry {
  dateVisited: string; // ISO 8601 timestamp for the visit.
  title?: string; // Page title captured for the visit.
  url: string; // Visited URL.
}
```

### `BrowserUserTabInfo`

```ts
interface BrowserUserTabInfo {
  id: string; // Opaque identifier for this browser tab.
  lastOpened?: string; // ISO 8601 timestamp for the last time the tab was opened or focused.
  providerTabId?: string; // Provider-owned identity for correlating an explicit reference with this fresh listing.
  tabGroup?: string; // User-visible tab group name when the tab belongs to one.
  title?: string; // User-visible tab title.
  url?: string; // Current tab URL.
}
```

### `BrowserUserTabContext`

```ts
type BrowserUserTabContext = { fileId: string; fileName: string; kind: "library_file"; libraryFileId: string; mimeType: string; title: string; url: string } | { kind: "text"; text: string; title: string; truncated: boolean; url: string } | { data: Uint8Array; fileName: string; kind: "document"; mimeType: string; title: string; url: string };
```

### `TabsContentOptions`

```ts
interface TabsContentOptions {
  contentType: TabsContentType; // Content representation to extract from each page.
  timeoutMs?: number; // Maximum time to wait for each page load, in milliseconds.
  urls: Array<string>; // URLs to load in temporary background tabs.
}
```

> 引用: `TabsContentType`

### `TabsContentResult`

```ts
interface TabsContentResult {
  content: null | string; // Extracted page content or null if the page failed to load or extract.
  title: null | string; // The resolved page title when available.
  url: string; // The resolved page URL when available, otherwise the requested URL.
}
```

### `TabInfo`

```ts
interface TabInfo {
  id: string; // Metadata describing an open tab.
  providerTabId?: string; // Provider-owned identifier for matching an explicitly mentioned tab.
  title?: string;
  url?: string;
}
```

### `TabCapabilityCollection`

```ts
type TabCapabilityCollection = {
  get(id: string): Promise<unknown>;
  list(): Promise<Array<{ id: string; description: string }>>;
};
```

### `Dialog`

```ts
type Dialog = AlertDialog | BeforeUnloadDialog | ConfirmDialog | PromptDialog;
```

> 引用: `AlertDialog`, `BeforeUnloadDialog`, `ConfirmDialog`, `PromptDialog`

### `ScreenshotOptions`

```ts
type ScreenshotOptions = {
  clip?: ClipRect; // Crop to a specific rectangle instead of the full viewport.
  fullPage?: boolean; // Capture the full page instead of the viewport.
};
```

> 引用: `ClipRect`

### `AXPoint`

```ts
type AXPoint = [unknown, unknown];
```

### `AXClickOptions`

```ts
type AXClickOptions = {
  clickCount?: number;
  duration?: number; // Seconds to hold each mouse press, from 0 through 30.
  key?: string; // Hold one key combination throughout the click sequence, for example "super" or "shift+a".
  mouseButton?: AXMouseButton;
};
```

> 引用: `AXMouseButton`

### `AXStateOptions`

```ts
type AXStateOptions = {
  disableDiffing?: boolean;
};
```

### `AXPasteOptions`

```ts
type AXPasteOptions = {
  format?: "text" | "md" | "html";
};
```

### `AXPressKeyOptions`

```ts
type AXPressKeyOptions = {
  duration?: number; // Seconds to hold the key combination before releasing it, from 0 through 30.
};
```

### `AXDirection`

```ts
type AXDirection = "up" | "down" | "left" | "right" | "u" | "d" | "l" | "r";
```

### `AXSelectTextOptions`

```ts
type AXSelectTextOptions = {
  prefix?: string;
  selectionType?: AXSelectionType;
  suffix?: string;
};
```

> 引用: `AXSelectionType`

### `ClickOptions`

```ts
type ClickOptions = {
  button?: number; // Mouse button (1-left, 2-middle/wheel, 3-right, 4-back, 5-forward).
  keypress?: Array<string>; // Modifier keys held during the click.
  x: number;
  y: number;
};
```

### `DoubleClickOptions`

```ts
type DoubleClickOptions = {
  keypress?: Array<string>; // Modifier keys held during the double click.
  x: number;
  y: number;
};
```

### `CuaDownloadMediaOptions`

```ts
type CuaDownloadMediaOptions = {
  timeoutMs?: number;
  x: number;
  y: number;
};
```

### `DragOptions`

```ts
type DragOptions = {
  keys?: Array<string>; // Optional modifier keys held during the drag.
  path: Array<{ x: number; y: number }>; // Drag path as a list of points.
};
```

### `KeypressOptions`

```ts
type KeypressOptions = {
  keys: Array<string>; // Key combination to press.
};
```

### `MoveOptions`

```ts
type MoveOptions = {
  keys?: Array<string>; // Optional modifier keys held while moving.
  x: number;
  y: number;
};
```

### `ScrollOptions`

```ts
type ScrollOptions = {
  keypress?: Array<string>; // Modifier keys held during scroll.
  scrollX: number;
  scrollY: number;
  x: number;
  y: number;
};
```

### `TypeOptions`

```ts
type TypeOptions = {
  text: string;
};
```

### `DomClickOptions`

```ts
type DomClickOptions = {
  node_id: string; // Node id from `get_visible_dom()`.
};
```

### `DomDownloadMediaOptions`

```ts
type DomDownloadMediaOptions = {
  node_id: string; // Node id from `get_visible_dom()`.
  timeoutMs?: number;
};
```

### `DomKeypressOptions`

```ts
type DomKeypressOptions = {
  keys: Array<string>; // Key combination to press.
};
```

### `DomScrollOptions`

```ts
type DomScrollOptions = {
  node_id?: string; // Optional node id to scroll within.
  x: number; // Horizontal scroll delta.
  y: number; // Vertical scroll delta.
};
```

### `DomTypeOptions`

```ts
type DomTypeOptions = {
  text: string; // Text to type into the currently focused element.
};
```

### `ElementInfoOptions`

```ts
type ElementInfoOptions = {
  includeNonInteractable?: boolean; // When true, include non-interactable elements in addition to interactable targets.
  x: number;
  y: number;
};
```

### `ElementInfo`

```ts
type ElementInfo = {
  ariaName?: string | null; // Accessible name if available.
  boundingBox?: ElementInfoRect | null; // Element bounds in screenshot coordinates.
  nodeId?: number | null; // Backend node id that can be passed to DOM-inspection APIs when available.
  preview: string; // Compact human-readable node preview.
  role?: string | null; // Computed ARIA role if available.
  selector: ElementInfoSelector; // Suggested selector data for this element.
  tagName: string; // Lowercased HTML tag name.
  testId?: string | null; // Configured test id attribute if present.
  visibleText?: string | null; // Rendered visible text, selected option text, or visible form value when available.
};
```

> 引用: `ElementInfoRect`, `ElementInfoSelector`

### `ElementScreenshotOptions`

```ts
type ElementScreenshotOptions = {
  includeNonInteractable?: boolean; // When true, highlight non-interactable elements in addition to interactable targets.
  x: number;
  y: number;
};
```

### `PlaywrightEvaluateFunction`

```ts
type PlaywrightEvaluateFunction<TArg, TResult> = string | (arg: TArg) => TResult | Promise<TResult>;
```

### `PlaywrightEvaluateOptions`

```ts
type PlaywrightEvaluateOptions = {
  timeoutMs?: number; // Maximum time to spend setting up the read-only DOM scope and running the script.
};
```

### `LoadState`

```ts
type LoadState = "load" | "domcontentloaded" | "networkidle";
```

### `TextMatcher`

```ts
type TextMatcher = string | RegExp;
```

### `WaitForEventOptions`

```ts
type WaitForEventOptions = {
  timeoutMs?: number;
};
```

### `PageWaitForLoadStateOptions`

```ts
type PageWaitForLoadStateOptions = {
  state?: LoadState;
  timeoutMs?: number;
};
```

> 引用: `LoadState`

### `PageWaitForURLOptions`

```ts
type PageWaitForURLOptions = {
  timeoutMs?: number;
  waitUntil?: WaitUntil;
};
```

> 引用: `WaitUntil`

### `LocatorCheckOptions`

```ts
type LocatorCheckOptions = {
  force?: boolean;
  timeoutMs?: number;
};
```

### `LocatorClickOptions`

```ts
type LocatorClickOptions = {
  button?: MouseButton;
  force?: boolean;
  modifiers?: Array<KeyboardModifier>;
  timeoutMs?: number;
};
```

> 引用: `MouseButton`, `KeyboardModifier`

### `LocatorDownloadMediaOptions`

```ts
type LocatorDownloadMediaOptions = {
  timeoutMs?: number; // Download timeout in milliseconds; defaults to 120000, excluding permission prompts.
};
```

### `LocatorEvaluateFunction`

```ts
type LocatorEvaluateFunction<TArg, TResult> = string | (element: Element, arg: TArg) => TResult | Promise<TResult>;
```

### `LocatorEvaluateAllFunction`

```ts
type LocatorEvaluateAllFunction<TArg, TResult> = string | (elements: Array<Element>, arg: TArg) => TResult | Promise<TResult>;
```

### `LocatorFilterOptions`

```ts
type LocatorFilterOptions = {
  has?: PlaywrightLocator;
  hasNot?: PlaywrightLocator;
  hasNotText?: TextMatcher;
  hasText?: TextMatcher;
  visible?: boolean;
};
```

> 引用: `PlaywrightLocator`, `TextMatcher`

### `LocatorLocatorOptions`

```ts
type LocatorLocatorOptions = {
  has?: PlaywrightLocator;
  hasNot?: PlaywrightLocator;
  hasNotText?: TextMatcher;
  hasText?: TextMatcher;
};
```

> 引用: `PlaywrightLocator`, `TextMatcher`

### `LocatorPressSequentiallyOptions`

```ts
type LocatorPressSequentiallyOptions = {
  timeoutMs?: number;
};
```

### `SelectOptionInput`

```ts
type SelectOptionInput = string | SelectOptionDescriptor;
```

> 引用: `SelectOptionDescriptor`

### `LocatorWaitForOptions`

```ts
type LocatorWaitForOptions = {
  state: WaitForState;
  timeoutMs?: number;
};
```

> 引用: `WaitForState`

### `FileChooserFiles`

```ts
type FileChooserFiles = string | Array<string>;
```

### `TabClipboardItem`

```ts
type TabClipboardItem = {
  entries: Array<TabClipboardEntry>;
  presentationStyle?: "unspecified" | "inline" | "attachment";
};
```

> 引用: `TabClipboardEntry`

### `TabDevLogsOptions`

```ts
interface TabDevLogsOptions {
  filter?: string; // Optional substring filter applied to the rendered log message.
  levels?: Array<"debug" | "info" | "log" | "warn" | "error" | "warning">; // Optional levels to include.
  limit?: number; // Maximum number of logs to return.
}
```

### `TabDevLogEntry`

```ts
interface TabDevLogEntry {
  level: "debug" | "info" | "log" | "warn" | "error"; // Console log level.
  message: string; // Rendered log message text.
  timestamp: string; // ISO 8601 timestamp for when the runtime captured the log.
  url?: string; // Source URL reported by the browser runtime, when available.
}
```

### `TabsContentType`

```ts
type TabsContentType = "html" | "text" | "domSnapshot";
```

### `ClipRect`

```ts
type ClipRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};
```

### `AXMouseButton`

```ts
type AXMouseButton = "left" | "right" | "middle" | "l" | "r" | "m";
```

### `AXSelectionType`

```ts
type AXSelectionType = "text" | "cursor_before" | "cursor_after";
```

### `ElementInfoRect`

```ts
type ElementInfoRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};
```

### `ElementInfoSelector`

```ts
type ElementInfoSelector = {
  candidates: Array<string>; // Ranked selector candidates for the element.
  frameSelectors?: Array<string>; // Frame selectors to enter before using the element selector.
  primary?: string | null; // The preferred selector for the element when available.
};
```

### `WaitUntil`

```ts
type WaitUntil = LoadState | "commit";
```

> 引用: `LoadState`

### `MouseButton`

```ts
type MouseButton = "left" | "right" | "middle";
```

### `KeyboardModifier`

```ts
type KeyboardModifier = "Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift";
```

### `SelectOptionDescriptor`

```ts
type SelectOptionDescriptor = {
  index?: number;
  label?: string;
  value?: string;
};
```

### `WaitForState`

```ts
type WaitForState = "attached" | "detached" | "visible" | "hidden";
```

### `TabClipboardEntry`

```ts
type TabClipboardEntry = {
  base64?: string;
  mimeType: string;
  text?: string;
};
```

---

## 核对结果

- 输入文件声明总条数：**219** 条（`interfaces` 成员 `declarations[]` 152 条 + `types` 各 `text` 67 条）
- 输出文件声明条数：**219** 条（统计方式：重新解析本文档中全部 ts 代码块）
- 是否一致：**一致**

- 输入 `interfaces` 数量：22；输出 `###` 接口小节数量：22
- 输入 `types` 数量：67；输出 `###` 类型小节数量：67
- 输入接口成员总数：147；输出 `####` 成员小节数量：147

逐条比对方式：对源文件中每一条声明文本在本文档内做字面子串匹配，全部命中；且本文档中 ts 代码块数量与声明总条数相等。

