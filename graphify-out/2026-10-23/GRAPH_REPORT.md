# Graph Report - call center  (2026-10-23)

## Corpus Check
- 81 files · ~554,849 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 18 file(s) not represented in the graph (top: (none) 4, .bat 4, .bak 4)

## Summary
- 2072 nodes · 4032 edges · 113 communities (87 shown, 26 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 264 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3f6b9044`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Document Processing & Viewer Engine
- onAudioRangeDateChange
- Ticket Workflow & Management
- Viewer Portal Client Interface
- Ticket Workflow & Management
- Authentication & User Sessions
- Call Audio Batch ML Analysis
- Document Processing & Viewer Engine
- Call Recording & Audio Indexing
- Asterisk Telephony & Queue AMI
- package.json
- Asterisk Telephony & Queue AMI
- Document Processing & Viewer Engine
- Call Center Database & CDR
- app.js
- Document Processing & Viewer Engine
- Excel Report & Data Export
- Excel Report & Data Export
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- sftpService.js
- Document Processing & Viewer Engine
- Viewer Portal Client Interface
- Call Center Database & CDR
- Call Center Database & CDR
- 3CX Desktop Telephony Agent
- handleWsMessage
- Viewer Portal Client Interface
- runInit
- getTodayDateString
- services/issabelDbService.js
- ProxmoxService Subsystem
- Viewer Portal Client Interface
- parseString
- dashboard.js
- scripts/deploy.js
- Viewer Portal Client Interface
- fetchAndRenderDetailCalls
- createBuffer
- renderCallbacks
- Dashboard Client UI Logic
- Dashboard Client UI Logic
- isObject
- AudioIndexService
- Dashboard Client UI Logic
- Document Processing & Viewer Engine
- updateQueueInfoModal
- Telegram Bot Integration
- Package Dependencies & Configuration
- redisService.js Subsystem
- test_dashboard_recent_tab Subsystem
- SftpService Subsystem
- escapeRegex() Subsystem
- VoicePrintService Subsystem
- voiceSnowballService.js
- fetchAndRenderDetailCalls
- voice_scan_orchestrator.j Subsystem
- SttService Subsystem
- viewer/scripts/deploy.js
- BlacklistService Subsystem
- Document Processing & Viewer Engine
- BlacklistService Subsystem
- blacklist.js Subsystem
- blacklist.js Subsystem
- Document Processing & Viewer Engine
- i18n.js Subsystem
- cleanup_missed_dupes.js Subsystem
- SyncService Subsystem
- systemService.js Subsystem
- Numbering
- i18n.js Subsystem
- Viewer Portal Client Interface
- fetch_and_prepare_samples.js
- SyncService Subsystem
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- GeminiService Subsystem
- Document Processing & Viewer Engine
- Ticket Workflow & Management
- assertPreReplacementValidityInDocument
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- codePoint
- Viewer Portal Client Interface
- Document Processing & Viewer Engine
- ref_path
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- applyHistoryColumnsVisibility
- Document Processing & Viewer Engine
- applyOpCardFieldsVisibility
- encodeChunk
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Graphify Knowledge Graph  Subsystem
- _onUpdateChild
- readNumberingXml
- convert
- checkIEEE754
- getTextContent
- importNode

## God Nodes (most connected - your core abstractions)
1. `BodyReader()` - 45 edges
2. `AmiService` - 43 edges
3. `AmiService` - 42 edges
4. `AuthService` - 40 edges
5. `DbService` - 37 edges
6. `IssabelDbService` - 33 edges
7. `DocumentConversion()` - 28 edges
8. `IssabelDbService` - 27 edges
9. `DbService` - 26 edges
10. `getTodayDateString()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `Modern Sidebar Design & Conversation Monitor` --semantically_similar_to--> `Realtime Dashboard UI & Monitor Drawer`  [INFERRED] [semantically similar]
  Call Center — yangi dizayn.html → public/index.html
- `3CX Desktop Agent & Notification System` --conceptually_related_to--> `Call Center Dashboard System`  [INFERRED]
  3cx-desktop-agent/README.md → README.md
- `Realtime Dashboard UI & Monitor Drawer` --implements--> `Call Center Dashboard System`  [EXTRACTED]
  public/index.html → README.md
- `Tickets & Viewer Subsystem` --references--> `Call Center Dashboard System`  [EXTRACTED]
  viewer/public/tickets.html → README.md
- `main()` --calls--> `VoiceMatcher`  [EXTRACTED]
  scripts/batch_scan.py → scripts/voice_matcher.py

## Import Cycles
- 2-file cycle: `services/authService.js -> services/issabelDbService.js -> services/authService.js`
- 3-file cycle: `services/audioIndexService.js -> services/sftpService.js -> services/issabelDbService.js -> services/audioIndexService.js`

## Hyperedges (group relationships)
- **Call Center Operational Ecosystem** — readme_call_center_system, public_index_dashboard_ui, desktop_agent_3cx, viewer_tickets_ui [INFERRED 0.85]

## Communities (113 total, 26 thin omitted)

### Community 0 - "Document Processing & Viewer Engine"
Cohesion: 0.01
Nodes (33): combineMessages(), containsMessage(), contentTypes(), convertElementToRawText(), debounce(), Document(), elementWithTag(), equalTo() (+25 more)

### Community 1 - "onAudioRangeDateChange"
Cohesion: 0.14
Nodes (16): clearHistorySelection(), downloadSelectedHistoryAudio(), formatDisplayDate(), handleHistoryRowSelect(), navAudioRangeCal(), onAudioRangeDateChange(), openAudioRangeModal(), renderAudioRangeCalendar() (+8 more)

### Community 2 - "Ticket Workflow & Management"
Cohesion: 0.06
Nodes (64): acceptCurrentTicket(), acceptTicketApi(), addCommentApi(), closeCreateModal(), closeDocViewer(), closeEditModal(), closeImpersonateModal(), closeLightbox() (+56 more)

### Community 3 - "Viewer Portal Client Interface"
Cohesion: 0.05
Nodes (54): cachedViewerHistoryList, cancelOutgoingHelp(), clientContactsMap, closeOutgoingHelpModal(), closeViewerProfileModal(), copyViewerCallbackPhone(), currentActiveConversations, currentOperators (+46 more)

### Community 4 - "Ticket Workflow & Management"
Cohesion: 0.05
Nodes (42): app, broadcastActiveViewers(), broadcastTicketEvent(), connectedViewers, extractToken(), findSocketsForOperator(), getActiveViewersList(), handleHelpCancel() (+34 more)

### Community 6 - "Call Audio Batch ML Analysis"
Cohesion: 0.14
Nodes (21): main(), load_audio(), main(), load_audio(), main(), load_audio(), main(), normalize_audio() (+13 more)

### Community 7 - "Document Processing & Viewer Engine"
Cohesion: 0.09
Nodes (46): BodyReader(), calculateRowSpans(), findBlipImageFile(), findEmbeddedImageFile(), isBlank(), noteReferenceReader(), parseCurrentInstrText(), parseInstrText() (+38 more)

### Community 10 - "package.json"
Cohesion: 0.05
Nodes (40): dependencies, acme-client, archiver, asterisk-manager, cors, dotenv, exceljs, express (+32 more)

### Community 12 - "Document Processing & Viewer Engine"
Cohesion: 0.07
Nodes (43): baseIteratee(), cb(), contains(), createEscaper(), createIndexFinder(), createPredicateIndexFinder(), createReduce(), createRule() (+35 more)

### Community 14 - "app.js"
Cohesion: 0.10
Nodes (10): agentReleaseConfig, agentUpdateLogsHistory, app, sslCertPath, sslKeyPath, wss, archiver, jobs (+2 more)

### Community 15 - "Document Processing & Viewer Engine"
Cohesion: 0.11
Nodes (27): escapeHtmlAttribute(), escapeHtmlText(), escapeMarkdown(), markdownImage(), markdownLink(), markdownWriter(), asString(), close() (+19 more)

### Community 16 - "Excel Report & Data Export"
Cohesion: 0.10
Nodes (18): cyrillicToLatin(), ExportService, formatDurationHms(), getExcludedOperators(), MONTH_NAMES_RU, MONTH_NAMES_RU_NOM, MONTH_NAMES_UZ, OPERATOR_DISPLAY_NAMES_RU (+10 more)

### Community 17 - "Excel Report & Data Export"
Cohesion: 0.07
Nodes (28): mammoth, dependencies, asterisk-manager, cors, dotenv, exceljs, express, ioredis (+20 more)

### Community 18 - "Document Processing & Viewer Engine"
Cohesion: 0.07
Nodes (31): arrayIndexOf(), read(), bidirectionalIndexOf(), collapseAlternateContent(), createBodyReader(), deepGet(), DocumentXmlReader(), convertXmlToDocument() (+23 more)

### Community 19 - "Document Processing & Viewer Engine"
Cohesion: 0.15
Nodes (28): deferredConversion(), DocumentConversion(), convertBreak(), convertComment(), convertCommentReference(), convertElements(), convertParagraph(), convertRun() (+20 more)

### Community 21 - "Document Processing & Viewer Engine"
Cohesion: 0.14
Nodes (15): asciiToBytes(), asciiWrite(), base64clean(), base64ToBytes(), base64Write(), blitBuffer(), byteLength(), getLens() (+7 more)

### Community 22 - "Viewer Portal Client Interface"
Cohesion: 0.13
Nodes (27): closeContactModal(), deleteContactFromDirectory(), escapeAttr(), escapeHtml(), generateStarRatingHtml(), getCallbackRelativeTime(), getPresenceRank(), handleDeleteContactClick() (+19 more)

### Community 25 - "3CX Desktop Telephony Agent"
Cohesion: 0.13
Nodes (17): compareVersions(), config, configPath, discoverServer(), exeDir, operatorId, performAutoUpdate(), performFullHistoryResync() (+9 more)

### Community 26 - "handleWsMessage"
Cohesion: 0.09
Nodes (34): addRecentDashboardRow(), applyDashboardRecentFilters(), changeRecentPage(), escapeHtml(), formatCallerNumberOrOperator(), generateStarRatingHtml(), getBronzeWreathBadgeHtml(), getClientContact() (+26 more)

### Community 27 - "Viewer Portal Client Interface"
Cohesion: 0.12
Nodes (21): checkSuperuserPrivileges(), checkVersionFromServer(), closeOperatorSelectSelfModal(), executeDeployReload(), fetchActiveViewers(), fetchViewerCallbacks(), handleHelpRequestStatus(), handleServerBuildId() (+13 more)

### Community 28 - "runInit"
Cohesion: 0.10
Nodes (26): applyAudioRangeToTable(), applyHistoryFilters(), closeAudioRangeModal(), getTabTitle(), initCharts(), initHeaderClock(), initHistoryPagination(), initSidebar() (+18 more)

### Community 29 - "getTodayDateString"
Cohesion: 0.10
Nodes (33): backToDateRangeModal(), changeCalendarMonth(), closeExportChoiceModal(), createDayCell(), downloadExcelReport(), executeExportDownload(), filterTabAgentLogsByOperator(), formatDateDisplay() (+25 more)

### Community 30 - "services/issabelDbService.js"
Cohesion: 0.22
Nodes (5): DEFAULT_OPERATOR_NAMES, EXCLUDED_OPERATORS, EXCLUDED_OPERATORS, main(), runAsyncTest()

### Community 32 - "Viewer Portal Client Interface"
Cohesion: 0.14
Nodes (18): closeDetailModal(), closeViewerHistoryModal(), fetchAndRenderDetailCalls(), filterDetailByCategory(), formatCallerNumber(), formatHangupParty(), formatSeconds(), getCleanOperatorName() (+10 more)

### Community 33 - "parseString"
Cohesion: 0.18
Nodes (13): createStyleRule(), describeError(), describeFailure(), documentMatcherRule(), htmlPathRule(), parseString(), readDocumentMatcher(), readHtmlPath() (+5 more)

### Community 34 - "dashboard.js"
Cohesion: 0.02
Nodes (78): adminClientsData, adminTopCallersData, appendOtaLog(), audioRangeCalCurrentDate, audioTagBadge, batchSttItems, btnPlayPause, cancelSttEditMode() (+70 more)

### Community 35 - "scripts/deploy.js"
Cohesion: 0.12
Nodes (12): ssh2, archivePath, currentBuild, indexHtmlPath, projectRoot, SERVER_PORT, tempDir, versionFilePath (+4 more)

### Community 36 - "Viewer Portal Client Interface"
Cohesion: 0.23
Nodes (9): acceptIncomingHelp(), handleHelpCancelled(), handleHelpResponseReceived(), handleIncomingHelpRequest(), notifyDesktop(), OperatorRingtonePlayer, rejectIncomingHelp(), startTitleBlink() (+1 more)

### Community 37 - "fetchAndRenderDetailCalls"
Cohesion: 0.29
Nodes (10): closeDetailModal(), fetchAndRenderDetailCalls(), filterDetailByCategory(), getCleanOperatorName(), handleDetailSearch(), initDetailModalEvents(), openCallsDetail(), openOperatorDetail() (+2 more)

### Community 38 - "createBuffer"
Cohesion: 0.27
Nodes (13): alloc(), allocUnsafe(), assertSize(), Buffer(), checked(), createBuffer(), from(), fromArrayBuffer() (+5 more)

### Community 39 - "renderCallbacks"
Cohesion: 0.14
Nodes (20): clearAllCallbacks(), copyCallbackPhone(), deleteCallback(), fallbackCopyCallbackPhone(), fetchCallbacksInitial(), findActiveCallForPhone(), getAdminCallbackRelativeTime(), getPhone9() (+12 more)

### Community 40 - "Dashboard Client UI Logic"
Cohesion: 0.16
Nodes (16): clearClientsSearch(), closeAdminClientModal(), deleteAdminClient(), deleteAdminClientFromModal(), getClientLangBadgeHtml(), handleAdminClientSubmit(), handleClientsSearch(), handleWsClientContactUpdate() (+8 more)

### Community 41 - "Dashboard Client UI Logic"
Cohesion: 0.23
Nodes (15): closeAudioPlayer(), formatBytes(), formatDuration(), getNativeAudio(), initAudioKeyboardShortcuts(), initWaveSurfer(), openInExplorerStudio(), playAudioFile() (+7 more)

### Community 42 - "isObject"
Cohesion: 0.10
Nodes (22): allKeys(), baseCreate(), clone(), collectNonEnumProps(), create(), ctor(), deepEq(), emulatedSet() (+14 more)

### Community 44 - "Dashboard Client UI Logic"
Cohesion: 0.21
Nodes (15): classifyAudioFile(), estimateAudioDuration(), explorerGoBack(), explorerGoForward(), explorerGoUp(), filterExplorerItems(), formatExplorerDateTime(), formatExplorerFullDateTime() (+7 more)

### Community 45 - "Document Processing & Viewer Engine"
Cohesion: 0.17
Nodes (15): appendElement(), copyLocator(), ElementAttributes(), fixSelfClosed(), parse(), appendText(), entityReplacer(), fixedFromCharCode() (+7 more)

### Community 46 - "updateQueueInfoModal"
Cohesion: 0.24
Nodes (11): adjustQueueCalls(), fetchQueueSyncSettings(), openQueueInfoModal(), promptCustomQueueCalls(), setQueueInfoFilter(), setQueueOperatorGroup(), toggleQueueDbSync(), triggerQueueSyncNow() (+3 more)

### Community 48 - "Package Dependencies & Configuration"
Cohesion: 0.29
Nodes (5): acme-client, CHALLENGE_DIR, PUBLIC_DIR, SSL_DIR, VIEWER_SSL_DIR

### Community 50 - "test_dashboard_recent_tab Subsystem"
Cohesion: 0.14
Nodes (9): context, ElementMock, elements, endIdx, fullCode, manyCalls, recentCallsCode, sampleCalls (+1 more)

### Community 54 - "voiceSnowballService.js"
Cohesion: 0.29
Nodes (6): CALLS_DIR, CANDIDATES_JSON, IDENTIFICATIONS_JSON, SAMPLES_DIR, sliceWavBuffer(), VoiceSnowballService

### Community 55 - "fetchAndRenderDetailCalls"
Cohesion: 0.16
Nodes (20): formatHangupParty(), formatOperatorDisplayName(), formatSeconds(), getFilteredSortedDetailCalls(), isCallerExpanded(), openBatchTranscribeModal(), openQueueDetail(), prependLiveHistoryRow() (+12 more)

### Community 56 - "voice_scan_orchestrator.j Subsystem"
Cohesion: 0.25
Nodes (8): CALLS_DIR, checkRemoteRestartFlag(), isInRange(), main(), saveLiveProgress(), syncRemote(), STATUS_FILE, VOICE_ID_FILE

### Community 58 - "viewer/scripts/deploy.js"
Cohesion: 0.11
Nodes (13): ssh2-sftp-client, diffData, diffFilePath, filesToPull, projectRoot, SERVER_PORT, skipPatterns, archivePath (+5 more)

### Community 60 - "Document Processing & Viewer Engine"
Cohesion: 0.24
Nodes (10): element(), elements(), elementsOfType(), HtmlPath(), isMatch(), Matcher(), Paragraph(), Run() (+2 more)

### Community 62 - "blacklist.js Subsystem"
Cohesion: 0.36
Nodes (7): bindGlobalKeys(), escapeHtml(), formatDate(), initBlacklistUI(), injectModals(), injectStyles(), renderBlacklistTable()

### Community 63 - "blacklist.js Subsystem"
Cohesion: 0.36
Nodes (7): bindGlobalKeys(), escapeHtml(), formatDate(), initBlacklistUI(), injectModals(), injectStyles(), renderBlacklistTable()

### Community 64 - "Document Processing & Viewer Engine"
Cohesion: 0.22
Nodes (9): asciiSlice(), base64Slice(), decodeCodePointsArray(), hexSlice(), latin1Slice(), slowToString(), toHex(), utf16leSlice() (+1 more)

### Community 65 - "i18n.js Subsystem"
Cohesion: 0.39
Nodes (6): applyTranslations(), I18N_TRANSLATIONS, initI18n(), switchLanguage(), t(), tf()

### Community 66 - "cleanup_missed_dupes.js Subsystem"
Cohesion: 0.25
Nodes (7): byOp, db, dbPath, del, rows, todayStr, toDelete

### Community 67 - "SyncService Subsystem"
Cohesion: 0.36
Nodes (3): SyncService, cleanPhone(), isDuplicate()

### Community 68 - "systemService.js Subsystem"
Cohesion: 0.38
Nodes (6): formatBytes(), formatSeconds(), getAudioDiskInfo(), getCpuUsagePromise(), getPhysicalDiskInfo(), SystemService

### Community 69 - "Numbering"
Cohesion: 0.67
Nodes (3): Numbering(), findLevel(), findLevelWithSeenNumIds()

### Community 70 - "i18n.js Subsystem"
Cohesion: 0.39
Nodes (6): applyTranslations(), I18N_TRANSLATIONS, initI18n(), switchLanguage(), t(), tf()

### Community 71 - "Viewer Portal Client Interface"
Cohesion: 0.32
Nodes (8): changeToolZoomStep(), closeToolModal(), getToolImageBaseWidth(), handleToolImageWheel(), openToolInModal(), resetToolImageZoom(), setToolImageZoom(), toggleToolImageZoom()

### Community 72 - "fetch_and_prepare_samples.js"
Cohesion: 0.40
Nodes (3): CALLS_DIR, MANUAL_CALLS, TOP_AI_CALLS

### Community 73 - "SyncService Subsystem"
Cohesion: 0.36
Nodes (3): SyncService, cleanPhone(), isDuplicate()

### Community 74 - "Document Processing & Viewer Engine"
Cohesion: 0.33
Nodes (7): _$1(), chain(), chainResult(), escapeChar(), functions(), mixin(), template()

### Community 75 - "Document Processing & Viewer Engine"
Cohesion: 0.29
Nodes (7): appendChild(), collapse(), collapseElement(), collapseNode(), elementEmptier(), removeEmpty(), simplify()

### Community 76 - "Document Processing & Viewer Engine"
Cohesion: 0.43
Nodes (7): apply(), InfixRules(), apply(), applyToTokens(), ruleNames(), untilExclusive(), untilInclusive()

### Community 77 - "Document Processing & Viewer Engine"
Cohesion: 0.48
Nodes (7): write(), writeString(), mapElementName(), writeDocument(), writeElement(), writeNode(), writeTextNode()

### Community 78 - "GeminiService Subsystem"
Cohesion: 0.22
Nodes (3): GeminiService, STATUS_FILE, SUBSCRIBERS_FILE

### Community 79 - "Document Processing & Viewer Engine"
Cohesion: 0.40
Nodes (6): readNumberingStyleElement(), readStyleElement(), readStyleId(), readStylesXml(), styleName(), Styles()

### Community 80 - "Ticket Workflow & Management"
Cohesion: 0.40
Nodes (5): Modern Sidebar Design & Conversation Monitor, 3CX Desktop Agent & Notification System, Realtime Dashboard UI & Monitor Drawer, Call Center Dashboard System, Tickets & Viewer Subsystem

### Community 81 - "assertPreReplacementValidityInDocument"
Cohesion: 0.12
Nodes (39): A(), _addNamedNode(), assertPreInsertionValidity1to5(), assertPreInsertionValidityInDocument(), assertPreReplacementValidityInDocument(), hasDoctypeChildThatIsNotChild(), c(), i() (+31 more)

### Community 82 - "Document Processing & Viewer Engine"
Cohesion: 0.50
Nodes (5): addSerializedAttribute(), needNamespaceDefine(), nodeSerializeToString(), serializeToString(), _xmlEncoder()

### Community 83 - "Document Processing & Viewer Engine"
Cohesion: 0.40
Nodes (5): copy(), _extends(), LiveNodeList(), __set__(), _updateLiveList()

### Community 84 - "codePoint"
Cohesion: 0.67
Nodes (3): codePoint(), dec(), hex()

### Community 85 - "Viewer Portal Client Interface"
Cohesion: 0.83
Nodes (4): getClientContact(), openAddContactModal(), openContactModal(), openEditContactModal()

### Community 86 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (4): addOrUpdateElement(), updateContentTypes(), updateRelationships(), writeStyleMap()

### Community 87 - "ref_path"
Cohesion: 0.18
Nodes (5): EXCLUDED_OPERATORS, KNOWN_OPERATORS, DB_FILE, EXCLUDED_OPERATORS, KNOWN_OPERATORS

### Community 88 - "Document Processing & Viewer Engine"
Cohesion: 0.50
Nodes (4): cleanUpNextTick(), drainQueue(), runClearTimeout(), runTimeout()

### Community 89 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (3): createCommentsReader(), readCommentElement(), readCommentsXml()

### Community 90 - "Document Processing & Viewer Engine"
Cohesion: 0.83
Nodes (4): createReader(), isFootnoteElement(), readFootnoteElement(), readNotesXml()

### Community 91 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (4): G(), K(), Y(), Z()

### Community 92 - "Document Processing & Viewer Engine"
Cohesion: 0.50
Nodes (4): notEmptyString(), orderedSetReducer(), splitOnASCIIWhitespace(), toOrderedSet()

### Community 93 - "Document Processing & Viewer Engine"
Cohesion: 0.83
Nodes (4): readString(), convertElement(), convertName(), convertNode()

### Community 94 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (4): XMLDocument(), XMLDocumentCB(), XMLStringifier(), XMLStringWriter()

### Community 96 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (3): buildErrorHandler(), build(), _locator()

### Community 97 - "applyHistoryColumnsVisibility"
Cohesion: 0.38
Nodes (7): applyHistoryColumnsVisibility(), isHistoryColumnVisible(), renderHistoryColsCheckboxes(), resetHistoryColumns(), saveHistoryColumnsSettings(), toggleHistoryColumn(), toggleHistoryColumnsDropdown()

### Community 98 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (3): cloneNode(), NamedNodeMap(), NodeList()

### Community 99 - "applyOpCardFieldsVisibility"
Cohesion: 0.38
Nodes (7): applyOpCardFieldsVisibility(), isOpCardFieldVisible(), openOpCardFieldsModal(), renderOpCardFieldsCheckboxes(), resetOpCardFields(), saveOpCardFieldsSettings(), toggleOpCardField()

### Community 100 - "encodeChunk"
Cohesion: 0.67
Nodes (3): encodeChunk(), fromByteArray(), tripletToBase64()

### Community 101 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (3): getDescendants(), getDescendantsOfType(), visitDescendants()

### Community 107 - "_onUpdateChild"
Cohesion: 0.50
Nodes (4): _appendSingleChild(), _insertBefore(), _onUpdateChild(), _removeChild()

### Community 108 - "readNumberingXml"
Cohesion: 0.50
Nodes (4): readAbstractNum(), readAbstractNums(), readNumberingXml(), readNums()

### Community 109 - "convert"
Cohesion: 0.29
Nodes (7): convert(), convertDocumentToHtml(), convertToHtml(), convertToMarkdown(), DocumentConverter(), readOptions(), readStyleMap()

### Community 110 - "checkIEEE754"
Cohesion: 0.67
Nodes (3): checkIEEE754(), writeDouble(), writeFloat()

## Knowledge Gaps
- **21 isolated node(s):** `asterisk-manager`, `cors`, `dotenv`, `exceljs`, `express` (+16 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 590 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **26 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DbService` connect `Call Center Database & CDR` to `ref_path`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Are the 11 inferred relationships involving `BodyReader()` (e.g. with `readChildElements()` and `readCommentReference()`) actually correct?**
  _`BodyReader()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **What connects `asterisk-manager`, `cors`, `dotenv` to the rest of the system?**
  _21 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Document Processing & Viewer Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.010091702865166073 - nodes in this community are weakly interconnected._
- **Why does `ssh2` connect `scripts/deploy.js` to `Excel Report & Data Export`, `viewer/scripts/deploy.js`, `systemService.js Subsystem`, `services/issabelDbService.js`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Should `onAudioRangeDateChange` be split into smaller, more focused modules?**
  _Cohesion score 0.14166666666666666 - nodes in this community are weakly interconnected._
- **Why does `AmiService` connect `Asterisk Telephony & Queue AMI` to `ref_path`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._