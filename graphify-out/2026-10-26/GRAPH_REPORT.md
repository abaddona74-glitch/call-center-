# Graph Report - call center  (2026-10-26)

## Corpus Check
- 85 files · ~566,749 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 18 file(s) not represented in the graph (top: (none) 4, .bat 4, .bak 4)

## Summary
- 2163 nodes · 4210 edges · 120 communities (94 shown, 26 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 270 edges (avg confidence: 0.85)
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
- formatSeconds
- Document Processing & Viewer Engine
- Excel Report & Data Export
- AudioIndexService
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
- ticketService.js
- getTodayDateString
- loadHistoryPage
- ProxmoxService Subsystem
- Viewer Portal Client Interface
- parseString
- dashboard.js
- renderTabAgentOperators
- Viewer Portal Client Interface
- requestOperatorHelp
- app.js
- renderCallbacks
- Dashboard Client UI Logic
- Dashboard Client UI Logic
- initPageElevator
- viewer/package.json
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
- systemService.js
- voice_scan_orchestrator.j Subsystem
- AudioIndexService
- viewer/scripts/deploy.js
- BlacklistService Subsystem
- Document Processing & Viewer Engine
- BlacklistService Subsystem
- blacklist.js Subsystem
- blacklist.js Subsystem
- Document Processing & Viewer Engine
- i18n.js Subsystem
- Numbering
- SyncService Subsystem
- drainQueue
- cleanup_missed_dupes.js
- i18n.js Subsystem
- runInit
- applyHistoryColumnsVisibility
- SyncService Subsystem
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- scripts/deploy.js
- Document Processing & Viewer Engine
- Ticket Workflow & Management
- Y
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- ref_path
- renderClientDirectory
- Document Processing & Viewer Engine
- services/issabelDbService.js
- isObject
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- s
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- convert
- Document Processing & Viewer Engine
- applyOpCardFieldsVisibility
- dependencies
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Graphify Knowledge Graph  Subsystem
- ZipJobService
- resetToolImageZoom
- renderSttText
- elementWithTag
- encodeChunk
- fetchServerStatus
- scripts
- GeminiService
- assertPreInsertionValidity1to5
- readNumberingXml
- updateTicket
- Notes
- _visitNode

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

## Communities (120 total, 26 thin omitted)

### Community 0 - "Document Processing & Viewer Engine"
Cohesion: 0.01
Nodes (34): checkIEEE754(), codePoint(), combineMessages(), containsMessage(), contentTypes(), convertElementToRawText(), debounce(), dec() (+26 more)

### Community 1 - "onAudioRangeDateChange"
Cohesion: 0.32
Nodes (8): formatDisplayDate(), navAudioRangeCal(), onAudioRangeDateChange(), openAudioRangeModal(), renderAudioRangeCalendar(), selectAudioRangeCalDate(), setAudioRangePreset(), updateAudioRangeInfo()

### Community 2 - "Ticket Workflow & Management"
Cohesion: 0.06
Nodes (64): acceptCurrentTicket(), acceptTicketApi(), addCommentApi(), closeCreateModal(), closeDocViewer(), closeEditModal(), closeImpersonateModal(), closeLightbox() (+56 more)

### Community 3 - "Viewer Portal Client Interface"
Cohesion: 0.05
Nodes (52): cachedViewerHistoryList, cancelOutgoingHelp(), clientContactsMap, closeOutgoingHelpModal(), closeViewerProfileModal(), convertImageInBrowser(), copyViewerCallbackPhone(), currentActiveConversations (+44 more)

### Community 4 - "Ticket Workflow & Management"
Cohesion: 0.08
Nodes (22): app, broadcastActiveViewers(), connectedViewers, extractToken(), findSocketsForOperator(), getActiveViewersList(), handleHelpCancel(), handleHelpRequest() (+14 more)

### Community 6 - "Call Audio Batch ML Analysis"
Cohesion: 0.10
Nodes (29): main(), load_audio(), main(), load_audio(), main(), load_audio(), main(), normalize_audio() (+21 more)

### Community 7 - "Document Processing & Viewer Engine"
Cohesion: 0.09
Nodes (46): BodyReader(), calculateRowSpans(), findBlipImageFile(), findEmbeddedImageFile(), isBlank(), noteReferenceReader(), parseCurrentInstrText(), parseInstrText() (+38 more)

### Community 10 - "package.json"
Cohesion: 0.05
Nodes (40): dependencies, acme-client, archiver, asterisk-manager, cors, dotenv, exceljs, express (+32 more)

### Community 12 - "Document Processing & Viewer Engine"
Cohesion: 0.08
Nodes (42): baseIteratee(), cb(), contains(), createEscaper(), createIndexFinder(), createPredicateIndexFinder(), createReduce(), createRule() (+34 more)

### Community 14 - "formatSeconds"
Cohesion: 0.15
Nodes (23): applyDashboardRecentFilters(), changeRecentPage(), formatHangupParty(), formatOperatorDisplayName(), formatSeconds(), getFilteredSortedDetailCalls(), isCallerExpanded(), openQueueDetail() (+15 more)

### Community 15 - "Document Processing & Viewer Engine"
Cohesion: 0.11
Nodes (27): escapeHtmlAttribute(), escapeHtmlText(), escapeMarkdown(), markdownImage(), markdownLink(), markdownWriter(), asString(), close() (+19 more)

### Community 16 - "Excel Report & Data Export"
Cohesion: 0.10
Nodes (18): cyrillicToLatin(), ExportService, formatDurationHms(), getExcludedOperators(), MONTH_NAMES_RU, MONTH_NAMES_RU_NOM, MONTH_NAMES_UZ, OPERATOR_DISPLAY_NAMES_RU (+10 more)

### Community 18 - "Document Processing & Viewer Engine"
Cohesion: 0.09
Nodes (25): arrayIndexOf(), read(), bidirectionalIndexOf(), collapseAlternateContent(), createBodyReader(), DocumentXmlReader(), convertXmlToDocument(), Files() (+17 more)

### Community 19 - "Document Processing & Viewer Engine"
Cohesion: 0.12
Nodes (31): deferredConversion(), DocumentConversion(), convertBreak(), convertComment(), convertCommentReference(), convertElements(), convertParagraph(), convertRun() (+23 more)

### Community 20 - "sftpService.js"
Cohesion: 0.28
Nodes (5): archiver, jobs, sanitizeFileName(), TEMP_ZIPS_DIR, waitingQueue

### Community 21 - "Document Processing & Viewer Engine"
Cohesion: 0.10
Nodes (28): alloc(), allocUnsafe(), asciiToBytes(), asciiWrite(), assertSize(), base64clean(), base64ToBytes(), base64Write() (+20 more)

### Community 22 - "Viewer Portal Client Interface"
Cohesion: 0.17
Nodes (21): closeContactModal(), deleteContactFromDirectory(), getCallbackRelativeTime(), getPresenceRank(), handleDeleteContactClick(), handleSaveContactSubmit(), handleWsClientContactUpdate(), loadClientContacts() (+13 more)

### Community 25 - "3CX Desktop Telephony Agent"
Cohesion: 0.13
Nodes (17): compareVersions(), config, configPath, discoverServer(), exeDir, operatorId, performAutoUpdate(), performFullHistoryResync() (+9 more)

### Community 26 - "handleWsMessage"
Cohesion: 0.09
Nodes (30): addRecentDashboardRow(), applyOperatorsFocusUI(), escapeHtml(), fetchExcludedOperatorsInitial(), formatCallerNumberOrOperator(), getClientContact(), getConversationKey(), getPresenceRank() (+22 more)

### Community 27 - "Viewer Portal Client Interface"
Cohesion: 0.12
Nodes (21): checkSuperuserPrivileges(), checkVersionFromServer(), closeOperatorSelectSelfModal(), executeDeployReload(), fetchActiveViewers(), fetchViewerCallbacks(), handleHelpRequestStatus(), handleServerBuildId() (+13 more)

### Community 28 - "ticketService.js"
Cohesion: 0.17
Nodes (17): acceptTicket(), addTicketComment(), checkAndRunMondayCleanup(), checkOperatorPermission(), completeTicket(), createTicket(), DATA_DIR, deleteTicket() (+9 more)

### Community 29 - "getTodayDateString"
Cohesion: 0.11
Nodes (30): changeCalendarMonth(), createDayCell(), downloadExcelReport(), filterTabAgentLogsByOperator(), formatDateDisplay(), formatIsoToUzDate(), getMonthName(), getTodayDateString() (+22 more)

### Community 30 - "loadHistoryPage"
Cohesion: 0.20
Nodes (14): applyAudioRangeToTable(), applyHistoryFilters(), closeAudioRangeModal(), getTabTitle(), loadHistoryPage(), loadSyncStatus(), openClientDirectoryModal(), resetHistoryFilters() (+6 more)

### Community 32 - "Viewer Portal Client Interface"
Cohesion: 0.15
Nodes (17): closeDetailModal(), closeToolModal(), closeViewerHistoryModal(), fetchAndRenderDetailCalls(), filterDetailByCategory(), formatHangupParty(), getCleanOperatorName(), getFilteredSortedDetailCalls() (+9 more)

### Community 33 - "parseString"
Cohesion: 0.18
Nodes (13): createStyleRule(), describeError(), describeFailure(), documentMatcherRule(), htmlPathRule(), parseString(), readDocumentMatcher(), readHtmlPath() (+5 more)

### Community 34 - "dashboard.js"
Cohesion: 0.02
Nodes (99): adminClientsData, adminTopCallersData, appendOtaLog(), audioRangeCalCurrentDate, audioTagBadge, backToDateRangeModal(), batchSttItems, btnPlayPause (+91 more)

### Community 35 - "renderTabAgentOperators"
Cohesion: 0.15
Nodes (17): closeDetailModal(), fetchAndRenderDetailCalls(), filterDetailByCategory(), generateStarRatingHtml(), getBronzeWreathBadgeHtml(), getCleanOperatorName(), getDiamondWreathBadgeHtml(), getGoldWreathBadgeHtml() (+9 more)

### Community 36 - "Viewer Portal Client Interface"
Cohesion: 0.23
Nodes (9): acceptIncomingHelp(), handleHelpCancelled(), handleHelpResponseReceived(), handleIncomingHelpRequest(), notifyDesktop(), OperatorRingtonePlayer, rejectIncomingHelp(), startTitleBlink() (+1 more)

### Community 37 - "requestOperatorHelp"
Cohesion: 0.29
Nodes (7): isMicrophoneSupported(), openOperatorSelectSelfModal(), requestOperatorHelp(), showLockedProfileNotice(), showRecordedPreview(), startPttRecord(), stopPttRecord()

### Community 38 - "app.js"
Cohesion: 0.09
Nodes (9): agentReleaseConfig, agentUpdateLogsHistory, app, sslCertPath, sslKeyPath, wss, convertFile(), getMimeType() (+1 more)

### Community 39 - "renderCallbacks"
Cohesion: 0.08
Nodes (32): applyManualTokenSwitch(), applyOperatorImpersonation(), cancelSttFromToast(), clearAllCallbacks(), closeImpersonateModal(), convertImageInBrowser(), copyBatchTranscriptions(), copyCallbackPhone() (+24 more)

### Community 40 - "Dashboard Client UI Logic"
Cohesion: 0.16
Nodes (16): clearClientsSearch(), closeAdminClientModal(), deleteAdminClient(), deleteAdminClientFromModal(), getClientLangBadgeHtml(), handleAdminClientSubmit(), handleClientsSearch(), handleWsClientContactUpdate() (+8 more)

### Community 41 - "Dashboard Client UI Logic"
Cohesion: 0.23
Nodes (15): closeAudioPlayer(), formatBytes(), formatDuration(), getNativeAudio(), initAudioKeyboardShortcuts(), initWaveSurfer(), openInExplorerStudio(), playAudioFile() (+7 more)

### Community 42 - "initPageElevator"
Cohesion: 0.60
Nodes (6): initPageElevator(), getActiveScrollTarget(), getMetrics(), handleScroll(), scheduleHide(), setDirection()

### Community 43 - "viewer/package.json"
Cohesion: 0.15
Nodes (12): mammoth, description, asterisk-manager, cors, dotenv, exceljs, express, ioredis (+4 more)

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
Cohesion: 0.15
Nodes (8): acme-client, CALLS_DIR, MANUAL_CALLS, TOP_AI_CALLS, CHALLENGE_DIR, PUBLIC_DIR, SSL_DIR, VIEWER_SSL_DIR

### Community 50 - "test_dashboard_recent_tab Subsystem"
Cohesion: 0.14
Nodes (9): context, ElementMock, elements, endIdx, fullCode, manyCalls, recentCallsCode, sampleCalls (+1 more)

### Community 54 - "voiceSnowballService.js"
Cohesion: 0.29
Nodes (6): CALLS_DIR, CANDIDATES_JSON, IDENTIFICATIONS_JSON, SAMPLES_DIR, sliceWavBuffer(), VoiceSnowballService

### Community 55 - "systemService.js"
Cohesion: 0.50
Nodes (6): formatBytes(), formatSeconds(), getAudioDiskInfo(), getCpuUsagePromise(), getPhysicalDiskInfo(), SystemService

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

### Community 66 - "Numbering"
Cohesion: 0.67
Nodes (3): Numbering(), findLevel(), findLevelWithSeenNumIds()

### Community 67 - "SyncService Subsystem"
Cohesion: 0.36
Nodes (3): SyncService, cleanPhone(), isDuplicate()

### Community 68 - "drainQueue"
Cohesion: 0.50
Nodes (4): cleanUpNextTick(), drainQueue(), runClearTimeout(), runTimeout()

### Community 69 - "cleanup_missed_dupes.js"
Cohesion: 0.25
Nodes (7): byOp, db, dbPath, del, rows, todayStr, toDelete

### Community 70 - "i18n.js Subsystem"
Cohesion: 0.39
Nodes (6): applyTranslations(), I18N_TRANSLATIONS, initI18n(), switchLanguage(), t(), tf()

### Community 71 - "runInit"
Cohesion: 0.10
Nodes (23): checkVersionFromServer(), executeDeployReload(), handleServerBuildId(), initCharts(), initDeployWatcher(), initHeaderClock(), initHistoryPagination(), initPageElevator() (+15 more)

### Community 72 - "applyHistoryColumnsVisibility"
Cohesion: 0.38
Nodes (7): applyHistoryColumnsVisibility(), isHistoryColumnVisible(), renderHistoryColsCheckboxes(), resetHistoryColumns(), saveHistoryColumnsSettings(), toggleHistoryColumn(), toggleHistoryColumnsDropdown()

### Community 73 - "SyncService Subsystem"
Cohesion: 0.36
Nodes (3): SyncService, cleanPhone(), isDuplicate()

### Community 74 - "Document Processing & Viewer Engine"
Cohesion: 0.33
Nodes (7): _$1(), chain(), chainResult(), escapeChar(), functions(), mixin(), template()

### Community 75 - "Document Processing & Viewer Engine"
Cohesion: 0.50
Nodes (4): appendChild(), collapse(), collapseElement(), collapseNode()

### Community 76 - "Document Processing & Viewer Engine"
Cohesion: 0.43
Nodes (7): apply(), InfixRules(), apply(), applyToTokens(), ruleNames(), untilExclusive(), untilInclusive()

### Community 77 - "Document Processing & Viewer Engine"
Cohesion: 0.48
Nodes (7): write(), writeString(), mapElementName(), writeDocument(), writeElement(), writeNode(), writeTextNode()

### Community 78 - "scripts/deploy.js"
Cohesion: 0.11
Nodes (13): ssh2, archivePath, currentBuild, deploy(), indexHtmlPath, projectRoot, SERVER_PORT, tempDir (+5 more)

### Community 79 - "Document Processing & Viewer Engine"
Cohesion: 0.40
Nodes (6): readNumberingStyleElement(), readStyleElement(), readStyleId(), readStylesXml(), styleName(), Styles()

### Community 80 - "Ticket Workflow & Management"
Cohesion: 0.40
Nodes (5): Modern Sidebar Design & Conversation Monitor, 3CX Desktop Agent & Notification System, Realtime Dashboard UI & Monitor Drawer, Call Center Dashboard System, Tickets & Viewer Subsystem

### Community 81 - "Y"
Cohesion: 0.67
Nodes (4): G(), K(), Y(), Z()

### Community 82 - "Document Processing & Viewer Engine"
Cohesion: 0.50
Nodes (5): addSerializedAttribute(), needNamespaceDefine(), nodeSerializeToString(), serializeToString(), _xmlEncoder()

### Community 83 - "Document Processing & Viewer Engine"
Cohesion: 0.40
Nodes (5): copy(), _extends(), LiveNodeList(), __set__(), _updateLiveList()

### Community 84 - "ref_path"
Cohesion: 0.18
Nodes (6): DB_FILE, EXCLUDED_OPERATORS, KNOWN_OPERATORS, DEFAULT_OPERATOR_NAMES, EXCLUDED_OPERATORS, EXCLUDED_OPERATORS

### Community 85 - "renderClientDirectory"
Cohesion: 0.22
Nodes (13): escapeAttr(), escapeHtml(), formatCallerNumber(), formatSeconds(), generateStarRatingHtml(), getClientContact(), handleDirectorySearch(), openAddContactModal() (+5 more)

### Community 86 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (4): addOrUpdateElement(), updateContentTypes(), updateRelationships(), writeStyleMap()

### Community 87 - "services/issabelDbService.js"
Cohesion: 0.17
Nodes (7): EXCLUDED_OPERATORS, KNOWN_OPERATORS, DEFAULT_OPERATOR_NAMES, EXCLUDED_OPERATORS, EXCLUDED_OPERATORS, main(), runAsyncTest()

### Community 88 - "isObject"
Cohesion: 0.07
Nodes (29): allKeys(), baseCreate(), clone(), collectNonEnumProps(), create(), ctor(), deepEq(), deepGet() (+21 more)

### Community 89 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (3): createCommentsReader(), readCommentElement(), readCommentsXml()

### Community 90 - "Document Processing & Viewer Engine"
Cohesion: 0.83
Nodes (4): createReader(), isFootnoteElement(), readFootnoteElement(), readNotesXml()

### Community 91 - "s"
Cohesion: 0.16
Nodes (31): A(), assertPreInsertionValidityInDocument(), assertPreReplacementValidityInDocument(), hasDoctypeChildThatIsNotChild(), c(), i(), n(), d() (+23 more)

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

### Community 97 - "convert"
Cohesion: 0.29
Nodes (7): convert(), convertDocumentToHtml(), convertToHtml(), convertToMarkdown(), DocumentConverter(), readOptions(), readStyleMap()

### Community 98 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (3): cloneNode(), NamedNodeMap(), NodeList()

### Community 99 - "applyOpCardFieldsVisibility"
Cohesion: 0.33
Nodes (9): applyOpCardFieldsVisibility(), isOpCardFieldVisible(), openOpCardFieldsModal(), renderOpCardFieldsCheckboxes(), resetOpCardFields(), saveOpCardFieldsSettings(), setAllOpCardFields(), toggleOpCardField() (+1 more)

### Community 100 - "dependencies"
Cohesion: 0.20
Nodes (10): dependencies, asterisk-manager, cors, dotenv, exceljs, express, ioredis, mammoth (+2 more)

### Community 101 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (3): getDescendants(), getDescendantsOfType(), visitDescendants()

### Community 108 - "resetToolImageZoom"
Cohesion: 0.38
Nodes (7): changeToolZoomStep(), getToolImageBaseWidth(), handleToolImageWheel(), openToolInModal(), resetToolImageZoom(), setToolImageZoom(), toggleToolImageZoom()

### Community 109 - "renderSttText"
Cohesion: 0.33
Nodes (6): cancelSttEditMode(), openCallTranscription(), renderSttText(), reprocessSttWithAi(), saveSttManualEdit(), switchSttViewMode()

### Community 110 - "elementWithTag"
Cohesion: 0.67
Nodes (3): elementWithTag(), freshElement(), nonFreshElement()

### Community 111 - "encodeChunk"
Cohesion: 0.67
Nodes (3): encodeChunk(), fromByteArray(), tripletToBase64()

### Community 112 - "fetchServerStatus"
Cohesion: 0.33
Nodes (6): fetchServerStatus(), openServerStatusModal(), toggleVmAutoRecover(), triggerVmAction(), triggerVmRecovery(), updateVmAutoRecoverUI()

### Community 113 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, deploy, dev, start, test

### Community 115 - "assertPreInsertionValidity1to5"
Cohesion: 0.18
Nodes (12): _addNamedNode(), _appendSingleChild(), assertPreInsertionValidity1to5(), DOMException(), _findNodeIndex(), hasValidParentNodeType(), _insertBefore(), _onAddAttribute() (+4 more)

### Community 116 - "readNumberingXml"
Cohesion: 0.50
Nodes (4): readAbstractNum(), readAbstractNums(), readNumberingXml(), readNums()

### Community 117 - "updateTicket"
Cohesion: 0.67
Nodes (3): broadcastTicketEvent(), handleTicketEdit(), updateTicket()

### Community 118 - "Notes"
Cohesion: 0.67
Nodes (3): Document(), noteKey(), Notes()

## Knowledge Gaps
- **21 isolated node(s):** `asterisk-manager`, `cors`, `dotenv`, `exceljs`, `express` (+16 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 601 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **26 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AuthService` connect `Authentication & User Sessions` to `app.js`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Are the 11 inferred relationships involving `BodyReader()` (e.g. with `readChildElements()` and `readCommentReference()`) actually correct?**
  _`BodyReader()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **What connects `asterisk-manager`, `cors`, `dotenv` to the rest of the system?**
  _21 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Document Processing & Viewer Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.010041295370571615 - nodes in this community are weakly interconnected._
- **Why does `ssh2` connect `scripts/deploy.js` to `viewer/package.json`, `ref_path`, `services/issabelDbService.js`, `systemService.js`, `viewer/scripts/deploy.js`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Should `Ticket Workflow & Management` be split into smaller, more focused modules?**
  _Cohesion score 0.06436487638533675 - nodes in this community are weakly interconnected._
- **Why does `AmiService` connect `Asterisk Telephony & Queue AMI` to `services/issabelDbService.js`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._