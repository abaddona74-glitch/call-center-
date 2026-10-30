# Graph Report - call center  (2026-10-29)

## Corpus Check
- 85 files · ~586,179 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 26 file(s) not represented in the graph (top: .ttf 6, (none) 4, .bat 4)

## Summary
- 2218 nodes · 4359 edges · 116 communities (92 shown, 24 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 271 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3100c5af`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Document Processing & Viewer Engine
- ticketService.js
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
- smoothCloseModal
- Document Processing & Viewer Engine
- Viewer Portal Client Interface
- Call Center Database & CDR
- Call Center Database & CDR
- 3CX Desktop Telephony Agent
- handleWsMessage
- Viewer Portal Client Interface
- smoothCloseDashboardModal
- getTodayDateString
- deepEq
- ProxmoxService Subsystem
- renderDetailTableBody
- parseString
- dashboard.js
- services/issabelDbService.js
- Viewer Portal Client Interface
- requestOperatorHelp
- app.js
- renderCallbacks
- Dashboard Client UI Logic
- scripts/deploy.js
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
- isObject
- BlacklistService Subsystem
- Document Processing & Viewer Engine
- BlacklistService Subsystem
- blacklist.js Subsystem
- blacklist.js Subsystem
- Document Processing & Viewer Engine
- i18n.js Subsystem
- Numbering
- SyncService Subsystem
- sendPresenceHeartbeat
- formatSeconds
- i18n.js Subsystem
- runInit
- applyHistoryColumnsVisibility
- SyncService Subsystem
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- onAudioRangeDateChange
- Document Processing & Viewer Engine
- Ticket Workflow & Management
- updateTicket
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- ref_path
- updateDistributionChartDisplay
- Document Processing & Viewer Engine
- cleanup_missed_dupes.js
- drainQueue
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- s
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Y
- Document Processing & Viewer Engine
- applyOpCardFieldsVisibility
- sftpService.js
- Document Processing & Viewer Engine
- Document Processing & Viewer Engine
- Graphify Knowledge Graph  Subsystem
- initPageElevator
- TopicAnalyticsService
- convert
- assertPreReplacementValidityInDocument
- readNumberingXml
- checkIEEE754
- telegramService.js
- viewer/scripts/deploy.js
- codePoint

## God Nodes (most connected - your core abstractions)
1. `BodyReader()` - 45 edges
2. `AmiService` - 43 edges
3. `AmiService` - 42 edges
4. `AuthService` - 41 edges
5. `DbService` - 37 edges
6. `IssabelDbService` - 33 edges
7. `DocumentConversion()` - 28 edges
8. `IssabelDbService` - 27 edges
9. `DbService` - 26 edges
10. `handleWsMessage()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `3CX Desktop Agent & Notification System` --conceptually_related_to--> `Call Center Dashboard System`  [INFERRED]
  3cx-desktop-agent/README.md → README.md
- `Realtime Dashboard UI & Monitor Drawer` --implements--> `Call Center Dashboard System`  [EXTRACTED]
  public/index.html → README.md
- `Tickets & Viewer Subsystem` --references--> `Call Center Dashboard System`  [EXTRACTED]
  viewer/public/tickets.html → README.md
- `main()` --calls--> `VoiceMatcher`  [EXTRACTED]
  scripts/batch_scan.py → scripts/voice_matcher.py
- `main()` --calls--> `VoiceMatcher`  [EXTRACTED]
  scripts/persistent_matcher_worker.py → scripts/voice_matcher.py

## Import Cycles
- 2-file cycle: `services/authService.js -> services/issabelDbService.js -> services/authService.js`
- 3-file cycle: `services/audioIndexService.js -> services/sftpService.js -> services/issabelDbService.js -> services/audioIndexService.js`

## Hyperedges (group relationships)
- **Call Center Operational Ecosystem** — readme_call_center_system, public_index_dashboard_ui, desktop_agent_3cx, viewer_tickets_ui [INFERRED 0.85]

## Communities (116 total, 24 thin omitted)

### Community 0 - "Document Processing & Viewer Engine"
Cohesion: 0.01
Nodes (38): combineMessages(), containsMessage(), contentTypes(), convertElementToRawText(), debounce(), Document(), elementWithTag(), encodeChunk() (+30 more)

### Community 1 - "ticketService.js"
Cohesion: 0.17
Nodes (17): acceptTicket(), addTicketComment(), checkAndRunMondayCleanup(), checkOperatorPermission(), completeTicket(), createTicket(), DATA_DIR, deleteTicket() (+9 more)

### Community 2 - "Ticket Workflow & Management"
Cohesion: 0.07
Nodes (65): acceptCurrentTicket(), acceptTicketApi(), addCommentApi(), closeCreateModal(), closeDocViewer(), closeEditModal(), closeImpersonateModal(), closeLightbox() (+57 more)

### Community 3 - "Viewer Portal Client Interface"
Cohesion: 0.05
Nodes (46): cachedViewerHistoryList, changeToolZoomStep(), clientContactsMap, convertImageInBrowser(), copyViewerCallbackPhone(), currentActiveConversations, currentOperators, currentViewerCallbacks (+38 more)

### Community 4 - "Ticket Workflow & Management"
Cohesion: 0.08
Nodes (22): app, broadcastActiveViewers(), connectedViewers, extractToken(), findSocketsForOperator(), getActiveViewersList(), handleHelpCancel(), handleHelpRequest() (+14 more)

### Community 6 - "Call Audio Batch ML Analysis"
Cohesion: 0.10
Nodes (29): main(), load_audio(), main(), load_audio(), main(), load_audio(), main(), normalize_audio() (+21 more)

### Community 7 - "Document Processing & Viewer Engine"
Cohesion: 0.09
Nodes (45): BodyReader(), calculateRowSpans(), findBlipImageFile(), findEmbeddedImageFile(), isBlank(), noteReferenceReader(), parseCurrentInstrText(), parseInstrText() (+37 more)

### Community 10 - "package.json"
Cohesion: 0.05
Nodes (40): dependencies, acme-client, archiver, asterisk-manager, cors, dotenv, exceljs, express (+32 more)

### Community 12 - "Document Processing & Viewer Engine"
Cohesion: 0.08
Nodes (42): baseIteratee(), cb(), contains(), createEscaper(), createIndexFinder(), createPredicateIndexFinder(), createReduce(), createRule() (+34 more)

### Community 14 - "formatSeconds"
Cohesion: 0.23
Nodes (15): closeAudioPlayer(), formatBytes(), formatDuration(), getNativeAudio(), initAudioKeyboardShortcuts(), initWaveSurfer(), openInExplorerStudio(), playAudioFile() (+7 more)

### Community 15 - "Document Processing & Viewer Engine"
Cohesion: 0.11
Nodes (27): escapeHtmlAttribute(), escapeHtmlText(), escapeMarkdown(), markdownImage(), markdownLink(), markdownWriter(), asString(), close() (+19 more)

### Community 16 - "Excel Report & Data Export"
Cohesion: 0.09
Nodes (20): cyrillicToLatin(), EXCLUDED_OPERATORS, ExportService, formatDurationHms(), getExcludedOperators(), MONTH_NAMES_RU, MONTH_NAMES_RU_NOM, MONTH_NAMES_UZ (+12 more)

### Community 18 - "Document Processing & Viewer Engine"
Cohesion: 0.09
Nodes (25): arrayIndexOf(), read(), bidirectionalIndexOf(), collapseAlternateContent(), createBodyReader(), DocumentXmlReader(), convertXmlToDocument(), Files() (+17 more)

### Community 19 - "Document Processing & Viewer Engine"
Cohesion: 0.12
Nodes (31): deferredConversion(), DocumentConversion(), convertBreak(), convertComment(), convertCommentReference(), convertElements(), convertParagraph(), convertRun() (+23 more)

### Community 20 - "smoothCloseModal"
Cohesion: 0.16
Nodes (14): closeClientDirectoryModal(), closeConverterModal(), closeDetailModal(), closeOperatorSelectSelfModal(), closeToolModal(), closeViewerHistoryModal(), closeViewerProfileModal(), initDetailModalEvents() (+6 more)

### Community 21 - "Document Processing & Viewer Engine"
Cohesion: 0.10
Nodes (28): alloc(), allocUnsafe(), asciiToBytes(), asciiWrite(), assertSize(), base64clean(), base64ToBytes(), base64Write() (+20 more)

### Community 22 - "Viewer Portal Client Interface"
Cohesion: 0.19
Nodes (19): closeContactModal(), deleteContactFromDirectory(), getCallbackRelativeTime(), handleDeleteContactClick(), handleSaveContactSubmit(), handleWsClientContactUpdate(), loadClientContacts(), loadExcludedOperatorsCache() (+11 more)

### Community 25 - "3CX Desktop Telephony Agent"
Cohesion: 0.13
Nodes (17): compareVersions(), config, configPath, discoverServer(), exeDir, operatorId, performAutoUpdate(), performFullHistoryResync() (+9 more)

### Community 26 - "handleWsMessage"
Cohesion: 0.08
Nodes (37): addRecentDashboardRow(), applyOperatorCardsScrollReveal(), applyOperatorsFocusUI(), escapeHtml(), fetchExcludedOperatorsInitial(), formatCallerNumberOrOperator(), getClientContact(), getConversationKey() (+29 more)

### Community 27 - "Viewer Portal Client Interface"
Cohesion: 0.14
Nodes (19): checkSuperuserPrivileges(), checkVersionFromServer(), executeDeployReload(), fetchActiveViewers(), fetchViewerCallbacks(), handleHelpRequestStatus(), handleServerBuildId(), initDeployWatcher() (+11 more)

### Community 28 - "smoothCloseDashboardModal"
Cohesion: 0.07
Nodes (28): applyOperatorImpersonation(), backToDateRangeModal(), closeAgentLogsModal(), closeAgentSettingsModal(), closeBatchTranscribeModal(), closeCallTranscriptionModal(), closeExportChoiceModal(), closeExportModal() (+20 more)

### Community 29 - "getTodayDateString"
Cohesion: 0.09
Nodes (37): changeCalendarMonth(), createDayCell(), downloadExcelReport(), filterTabAgentLogsByOperator(), formatDateDisplay(), formatIsoToUzDate(), generateStarRatingHtml(), getBronzeWreathBadgeHtml() (+29 more)

### Community 30 - "deepEq"
Cohesion: 0.12
Nodes (17): allKeys(), collectNonEnumProps(), deepEq(), deepGet(), emulatedSet(), eq(), get(), has() (+9 more)

### Community 32 - "renderDetailTableBody"
Cohesion: 0.11
Nodes (26): escapeAttr(), escapeHtml(), fetchAndRenderDetailCalls(), filterDetailByCategory(), formatCallerNumber(), formatHangupParty(), formatSeconds(), generateStarRatingHtml() (+18 more)

### Community 33 - "parseString"
Cohesion: 0.18
Nodes (13): createStyleRule(), describeError(), describeFailure(), documentMatcherRule(), htmlPathRule(), parseString(), readDocumentMatcher(), readHtmlPath() (+5 more)

### Community 34 - "dashboard.js"
Cohesion: 0.02
Nodes (108): adminClientsData, adminTopCallersData, appendOtaLog(), audioRangeCalCurrentDate, audioTagBadge, batchSttItems, btnPlayPause, cachedExcludeOperators (+100 more)

### Community 35 - "services/issabelDbService.js"
Cohesion: 0.17
Nodes (7): EXCLUDED_OPERATORS, KNOWN_OPERATORS, DEFAULT_OPERATOR_NAMES, EXCLUDED_OPERATORS, EXCLUDED_OPERATORS, main(), runAsyncTest()

### Community 36 - "Viewer Portal Client Interface"
Cohesion: 0.23
Nodes (9): acceptIncomingHelp(), handleHelpCancelled(), handleHelpResponseReceived(), handleIncomingHelpRequest(), notifyDesktop(), OperatorRingtonePlayer, rejectIncomingHelp(), startTitleBlink() (+1 more)

### Community 37 - "requestOperatorHelp"
Cohesion: 0.12
Nodes (17): cancelOutgoingHelp(), closeOutgoingHelpModal(), executeHelpRequest(), isMicrophoneSupported(), openOperatorSelectSelfModal(), requestOperatorHelp(), resetRecordedVoice(), sendDirectRingHelpRequest() (+9 more)

### Community 38 - "app.js"
Cohesion: 0.09
Nodes (10): agentReleaseConfig, agentUpdateLogsHistory, app, MULTIPLAYER_CURSOR_COLORS, sslCertPath, sslKeyPath, wss, convertFile() (+2 more)

### Community 39 - "renderCallbacks"
Cohesion: 0.09
Nodes (30): applyManualTokenSwitch(), cancelSttFromToast(), clearAllCallbacks(), convertImageInBrowser(), copyBatchTranscriptions(), copyCallbackPhone(), deleteCallback(), downloadBatchTranscriptionsTxt() (+22 more)

### Community 40 - "Dashboard Client UI Logic"
Cohesion: 0.21
Nodes (12): clearClientsSearch(), closeAdminClientModal(), deleteAdminClient(), deleteAdminClientFromModal(), getClientLangBadgeHtml(), handleAdminClientSubmit(), handleClientsSearch(), loadClientsTab() (+4 more)

### Community 41 - "scripts/deploy.js"
Cohesion: 0.11
Nodes (15): ssh2-sftp-client, archivePath, currentBuild, indexHtmlPath, projectRoot, SERVER_PORT, tempDir, versionFilePath (+7 more)

### Community 42 - "initPageElevator"
Cohesion: 0.60
Nodes (6): initPageElevator(), getActiveScrollTarget(), getMetrics(), handleScroll(), scheduleHide(), setDirection()

### Community 43 - "viewer/package.json"
Cohesion: 0.07
Nodes (28): mammoth, dependencies, asterisk-manager, cors, dotenv, exceljs, express, ioredis (+20 more)

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

### Community 58 - "isObject"
Cohesion: 0.18
Nodes (12): baseCreate(), clone(), create(), ctor(), executeBound(), isObject(), random(), sample() (+4 more)

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

### Community 68 - "sendPresenceHeartbeat"
Cohesion: 0.33
Nodes (11): claimActiveTab(), getActiveTabName(), getMyPcName(), getOrCreateDeviceId(), handleClientAssigned(), initMultiplayerCursors(), initWebSocket(), isThisTabActive() (+3 more)

### Community 69 - "formatSeconds"
Cohesion: 0.10
Nodes (33): applyDashboardRecentFilters(), changeRecentPage(), closeDetailModal(), fetchAndRenderDetailCalls(), filterDetailByCategory(), formatHangupParty(), formatOperatorDisplayName(), formatSeconds() (+25 more)

### Community 70 - "i18n.js Subsystem"
Cohesion: 0.39
Nodes (6): applyTranslations(), I18N_TRANSLATIONS, initI18n(), switchLanguage(), t(), tf()

### Community 71 - "runInit"
Cohesion: 0.09
Nodes (27): applyAudioRangeToTable(), applyHistoryFilters(), checkVersionFromServer(), closeAudioRangeModal(), executeDeployReload(), getTabTitle(), handleServerBuildId(), initDeployWatcher() (+19 more)

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

### Community 78 - "onAudioRangeDateChange"
Cohesion: 0.28
Nodes (9): formatDisplayDate(), navAudioRangeCal(), onAudioRangeDateChange(), openAudioRangeModal(), renderAudioRangeCalendar(), selectAudioRangeCalDate(), setAudioRangePreset(), updateAudioRangeInfo() (+1 more)

### Community 79 - "Document Processing & Viewer Engine"
Cohesion: 0.40
Nodes (6): readNumberingStyleElement(), readStyleElement(), readStyleId(), readStylesXml(), styleName(), Styles()

### Community 80 - "Ticket Workflow & Management"
Cohesion: 0.50
Nodes (4): 3CX Desktop Agent & Notification System, Realtime Dashboard UI & Monitor Drawer, Call Center Dashboard System, Tickets & Viewer Subsystem

### Community 81 - "updateTicket"
Cohesion: 0.67
Nodes (3): broadcastTicketEvent(), handleTicketEdit(), updateTicket()

### Community 82 - "Document Processing & Viewer Engine"
Cohesion: 0.50
Nodes (5): addSerializedAttribute(), needNamespaceDefine(), nodeSerializeToString(), serializeToString(), _xmlEncoder()

### Community 83 - "Document Processing & Viewer Engine"
Cohesion: 0.40
Nodes (5): copy(), _extends(), LiveNodeList(), __set__(), _updateLiveList()

### Community 84 - "ref_path"
Cohesion: 0.25
Nodes (3): DB_FILE, EXCLUDED_OPERATORS, KNOWN_OPERATORS

### Community 85 - "updateDistributionChartDisplay"
Cohesion: 0.40
Nodes (6): initCharts(), render2DDistribution(), setChartMode(), setDistributionFocusHighlight(), setDistributionType(), updateDistributionChartDisplay()

### Community 86 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (4): addOrUpdateElement(), updateContentTypes(), updateRelationships(), writeStyleMap()

### Community 87 - "cleanup_missed_dupes.js"
Cohesion: 0.25
Nodes (7): byOp, db, dbPath, del, rows, todayStr, toDelete

### Community 88 - "drainQueue"
Cohesion: 0.50
Nodes (4): cleanUpNextTick(), drainQueue(), runClearTimeout(), runTimeout()

### Community 89 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (3): createCommentsReader(), readCommentElement(), readCommentsXml()

### Community 90 - "Document Processing & Viewer Engine"
Cohesion: 0.83
Nodes (4): createReader(), isFootnoteElement(), readFootnoteElement(), readNotesXml()

### Community 91 - "s"
Cohesion: 0.30
Nodes (19): A(), c(), i(), n(), d(), t(), f(), h() (+11 more)

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

### Community 97 - "Y"
Cohesion: 0.67
Nodes (4): G(), K(), Y(), Z()

### Community 98 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (3): cloneNode(), NamedNodeMap(), NodeList()

### Community 99 - "applyOpCardFieldsVisibility"
Cohesion: 0.33
Nodes (9): applyOpCardFieldsVisibility(), isOpCardFieldVisible(), openOpCardFieldsModal(), renderOpCardFieldsCheckboxes(), resetOpCardFields(), saveOpCardFieldsSettings(), setAllOpCardFields(), toggleOpCardField() (+1 more)

### Community 100 - "sftpService.js"
Cohesion: 0.18
Nodes (6): archiver, jobs, sanitizeFileName(), TEMP_ZIPS_DIR, waitingQueue, ZipJobService

### Community 101 - "Document Processing & Viewer Engine"
Cohesion: 0.67
Nodes (3): getDescendants(), getDescendantsOfType(), visitDescendants()

### Community 107 - "initPageElevator"
Cohesion: 0.60
Nodes (6): initPageElevator(), getActiveScrollTarget(), getMetrics(), handleScroll(), scheduleHide(), setDirection()

### Community 109 - "convert"
Cohesion: 0.25
Nodes (8): convert(), convertDocumentToHtml(), convertToHtml(), convertToMarkdown(), DocumentConverter(), parseStyleMap(), readOptions(), readStyleMap()

### Community 110 - "assertPreReplacementValidityInDocument"
Cohesion: 0.14
Nodes (24): _addNamedNode(), _appendSingleChild(), assertPreInsertionValidity1to5(), assertPreInsertionValidityInDocument(), assertPreReplacementValidityInDocument(), hasDoctypeChildThatIsNotChild(), DOMException(), find() (+16 more)

### Community 111 - "readNumberingXml"
Cohesion: 0.50
Nodes (4): readAbstractNum(), readAbstractNums(), readNumberingXml(), readNums()

### Community 112 - "checkIEEE754"
Cohesion: 0.67
Nodes (3): checkIEEE754(), writeDouble(), writeFloat()

### Community 113 - "telegramService.js"
Cohesion: 0.20
Nodes (4): deploy(), GeminiService, STATUS_FILE, SUBSCRIBERS_FILE

### Community 114 - "viewer/scripts/deploy.js"
Cohesion: 0.12
Nodes (11): ssh2, conn, archivePath, currentBuild, projectRoot, SERVER_PORT, tempDir, versionFilePath (+3 more)

### Community 115 - "codePoint"
Cohesion: 0.67
Nodes (3): codePoint(), dec(), hex()

## Knowledge Gaps
- **21 isolated node(s):** `asterisk-manager`, `cors`, `dotenv`, `exceljs`, `express` (+16 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 601 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **24 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AmiService` connect `Asterisk Telephony & Queue AMI` to `services/issabelDbService.js`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 11 inferred relationships involving `BodyReader()` (e.g. with `readChildElements()` and `readCommentReference()`) actually correct?**
  _`BodyReader()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **What connects `asterisk-manager`, `cors`, `dotenv` to the rest of the system?**
  _21 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Document Processing & Viewer Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.00992836496166897 - nodes in this community are weakly interconnected._
- **Why does `ssh2` connect `viewer/scripts/deploy.js` to `services/issabelDbService.js`, `scripts/deploy.js`, `viewer/package.json`, `ref_path`, `systemService.js`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Should `Ticket Workflow & Management` be split into smaller, more focused modules?**
  _Cohesion score 0.0650103519668737 - nodes in this community are weakly interconnected._
- **Why does `SftpService` connect `SftpService Subsystem` to `sftpService.js`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._