module.exports = {
    openapi: '3.0.0',
    info: {
        title: 'Call Center AI & Issabel PBX API',
        version: '1.0.0',
        description: 'Issabel Asterisk PBX, MariaDB (CDR), SFTP audio yozuvlar va real-time AMI monitoring xizmati uchun to\'liq REST API hujjatlari.',
        contact: {
            name: 'Call Center Admin',
            email: 'admin@callcenter.local'
        }
    },
    servers: [
        {
            url: 'http://localhost:3000',
            description: 'Mahalliy Call Center Express Server'
        }
    ],
    tags: [
        {
            name: 'Database & CDR',
            description: 'MariaDB (asteriskcdrdb.cdr) va SQLite ma\'lumotlar bazasi bilan ishlash API lari'
        },
        {
            name: 'Monitoring & Stats',
            description: 'Real-time monitoring, statistikalar, navbatlar va operatorlar holati'
        },
        {
            name: 'Audio Explorer',
            description: '/var/spool/asterisk/monitor papkasidagi audio fayllar va pleyer streaming'
        },
        {
            name: 'Telephony Actions',
            description: 'Asterisk AMI orqali qo\'ng\'iroq qilish, transfer va hangup buyruqlari'
        }
    ],
    paths: {
        '/api/history': {
            get: {
                tags: ['Database & CDR'],
                summary: 'Barcha qo\'ng\'iroqlar jurnali (CDR Tarixi)',
                description: 'MariaDB asteriskcdrdb.cdr jadvalidan barcha qo\'ng\'iroqlarni sahifalab (pagination) va qidiruv bilan oladi.',
                parameters: [
                    {
                        name: 'page',
                        in: 'query',
                        description: 'Sahifa raqami (boshlang\'ich: 1)',
                        schema: { type: 'integer', default: 1 }
                    },
                    {
                        name: 'limit',
                        in: 'query',
                        description: 'Bir sahifadagi qatorlar soni',
                        schema: { type: 'integer', default: 20 }
                    },
                    {
                        name: 'search',
                        in: 'query',
                        description: 'Mijoz raqami, operator yoki holat bo\'yicha qidiruv filtri',
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    200: {
                        description: 'Qo\'ng\'iroqlar ro\'yxati va sahifalash ma\'lumotlari',
                        content: {
                            'application/json': {
                                example: {
                                    total: 706,
                                    page: 1,
                                    totalPages: 36,
                                    limit: 20,
                                    data: [
                                        {
                                            id: '1788346537.206935',
                                            time: '2026-09-02 15:55:23',
                                            callerId: '974549454',
                                            operator: 'Feruza (103)',
                                            direction: 'outbound',
                                            duration: 7,
                                            status: 'NO ANSWER',
                                            hangupParty: 'Normal',
                                            recording: 'out-974549454-103-20260902-155537-1788346537.206935.wav'
                                        }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/calls/details': {
            get: {
                tags: ['Database & CDR'],
                summary: 'Batafsil qo\'ng\'iroqlar (Drill-down filtrlash)',
                description: 'Ko\'rsatkichlar yoki operatorlar bo\'yicha aniq saralangan CDR ro\'yxati (kiruvchi, chiquvchi, javob berilgan, navbatdan chiqqan, band).',
                parameters: [
                    {
                        name: 'type',
                        in: 'query',
                        description: 'Qo\'ng\'iroq turi filtri',
                        schema: {
                            type: 'string',
                            enum: ['all', 'inbound', 'outbound', 'answered', 'abandoned', 'denied'],
                            default: 'all'
                        }
                    },
                    {
                        name: 'operator',
                        in: 'query',
                        description: 'Operator ichki raqami (masalan, 101, 103, 114)',
                        schema: { type: 'string' }
                    },
                    {
                        name: 'page',
                        in: 'query',
                        schema: { type: 'integer', default: 1 }
                    },
                    {
                        name: 'limit',
                        in: 'query',
                        schema: { type: 'integer', default: 50 }
                    },
                    {
                        name: 'search',
                        in: 'query',
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    200: {
                        description: 'Filtrlangan qo\'ng\'iroqlar ro\'yxati',
                        content: {
                            'application/json': {
                                example: {
                                    success: true,
                                    total: 14,
                                    page: 1,
                                    totalPages: 1,
                                    limit: 50,
                                    data: []
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/db/summary': {
            get: {
                tags: ['Database & CDR'],
                summary: 'Bugungi kunlik umumiy hisobot (MariaDB)',
                description: 'Asterisk CDR bazasidan bugungi jami, kiruvchi, chiquvchi, muvaffaqiyatli va bekor qilingan qo\'ng\'iroqlar ko\'rsatkichlari.',
                responses: {
                    200: {
                        description: 'Kunlik ko\'rsatkichlar agregatsiyasi',
                        content: {
                            'application/json': {
                                example: {
                                    success: true,
                                    data: {
                                        totalCalls: 706,
                                        inboundCalls: 692,
                                        outboundCalls: 14,
                                        answeredCalls: 540,
                                        abandonedCalls: 152,
                                        deniedCalls: 14,
                                        totalDurationSec: 64200,
                                        answerRate: 76
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/db/operators': {
            get: {
                tags: ['Database & CDR'],
                summary: 'Operatorlar kunlik ko\'rsatkichlari (MariaDB)',
                description: 'Har bir operatorning bugungi qabul qilgan qo\'ng\'iroqlari, suhbat vaqti va o\'rtacha davomiyligi.',
                responses: {
                    200: {
                        description: 'Operatorlar statistikasi ro\'yxati',
                        content: {
                            'application/json': {
                                example: {
                                    success: true,
                                    data: [
                                        {
                                            id: '103',
                                            name: 'Feruza (103)',
                                            realName: 'Feruza',
                                            totalCalls: 120,
                                            answered: 115,
                                            totalDurationSec: 14200,
                                            avgDurationSec: 123
                                        }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/db/query': {
            post: {
                tags: ['Database & CDR'],
                summary: 'Asterisk MariaDB ga to\'g\'ridan-to\'g\'ri SELECT so\'rovi yuborish',
                description: 'Xavfsiz read-only SQL so\'rovlarini (SELECT, SHOW, DESCRIBE) to\'g\'ridan-to\'g\'ri bajarish imkonini beradi. DROP, DELETE, INSERT va boshqa o\'zgartiruvchi buyruqlar qat\'iyan bloklangan.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['sql'],
                                properties: {
                                    sql: {
                                        type: 'string',
                                        example: 'SELECT calldate, src, dst, duration, disposition FROM asteriskcdrdb.cdr ORDER BY calldate DESC LIMIT 5;'
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        description: 'So\'rov natijasi',
                        content: {
                            'application/json': {
                                example: {
                                    success: true,
                                    query: 'SELECT calldate, src, dst FROM asteriskcdrdb.cdr LIMIT 2;',
                                    rawOutput: "2026-09-02 16:35:10\t901234567\t103\n2026-09-02 16:34:05\t939876543\t101"
                                }
                            }
                        }
                    },
                    403: {
                        description: 'Xavfsizlik cheklovi (faqat SELECT buyruqlari ruxsat etilgan)'
                    }
                }
            }
        },
        '/api/status': {
            get: {
                tags: ['Monitoring & Stats'],
                summary: 'Server va ulanishlar holati',
                description: 'Asterisk AMI va SFTP ulanishlari holatini tekshirish.',
                responses: {
                    200: {
                        description: 'Ulanish holati',
                        content: {
                            'application/json': {
                                example: {
                                    amiConnected: true,
                                    sftpConnected: true,
                                    host: '192.168.0.124'
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/stats': {
            get: {
                tags: ['Monitoring & Stats'],
                summary: 'Asosiy KPI statistika',
                description: 'Boshqaruv paneli (Dashboard) yuqori kartochkalari uchun agregatsiya qilingan statistika.',
                responses: {
                    200: {
                        description: 'Joriy statistik ko\'rsatkichlar',
                        content: {
                            'application/json': {
                                example: {
                                    totalCalls: 706,
                                    inboundCalls: 692,
                                    outboundCalls: 14,
                                    answeredCalls: 540,
                                    abandonedCalls: 152,
                                    deniedCalls: 14,
                                    queueWaiting: 2
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/queues': {
            get: {
                tags: ['Monitoring & Stats'],
                summary: 'Navbatlar ro\'yxati va navbatdagi mijozlar',
                description: 'Asterisk navbatlari (queues) va ularda kutayotgan mijozlar ro\'yxatini qaytaradi.',
                responses: {
                    200: {
                        description: 'Navbatlar ro\'yxati',
                        content: {
                            'application/json': {
                                example: [
                                    {
                                        name: '600',
                                        calls: 2,
                                        strategy: 'ringall',
                                        waiters: [
                                            {
                                                callerId: '991234567',
                                                waitSec: 15,
                                                position: 1
                                            }
                                        ]
                                    }
                                ]
                            }
                        }
                    }
                }
            }
        },
        '/api/channels': {
            get: {
                tags: ['Monitoring & Stats'],
                summary: 'Ayni paytdagi jonli suhbatlar (Faol kanallar)',
                description: 'Asterisk serverida real-time rejimda suhbatlashayotgan barcha kanallar ro\'yxati.',
                responses: {
                    200: {
                        description: 'Faol kanallar ro\'yxati',
                        content: {
                            'application/json': {
                                example: [
                                    {
                                        channel: 'SIP/103-00000a12',
                                        callerId: '974549454',
                                        operator: '103',
                                        durationSec: 42,
                                        state: 'Up'
                                    }
                                ]
                            }
                        }
                    }
                }
            }
        },
        '/api/operators': {
            get: {
                tags: ['Monitoring & Stats'],
                summary: 'Operatorlar holati va unumdorligi',
                description: 'Barcha operatorlarning real-time holati (bo\'sh, suhbatda, oflayn) va kunlik ko\'rsatkichlari.',
                responses: {
                    200: {
                        description: 'Operatorlar ro\'yxati',
                        content: {
                            'application/json': {
                                example: [
                                    {
                                        id: '101',
                                        name: 'Oybek (101)',
                                        status: 'busy',
                                        answered: 85,
                                        totalCalls: 92
                                    }
                                ]
                            }
                        }
                    }
                }
            }
        },
        '/api/recordings/tree': {
            get: {
                tags: ['Audio Explorer'],
                summary: 'SFTP audio papkalari va fayllari ro\'yxati',
                description: '/var/spool/asterisk/monitor papkasi ichidagi sana papkalari va WAV fayllarni ko\'rish.',
                parameters: [
                    {
                        name: 'path',
                        in: 'query',
                        description: 'Sub-papka yo\'li (masalan, 2026/09/02)',
                        schema: { type: 'string', default: '' }
                    }
                ],
                responses: {
                    200: {
                        description: 'Fayllar va papkalar ro\'yxati',
                        content: {
                            'application/json': {
                                example: [
                                    { name: '2026', isDirectory: true, size: 4096 },
                                    { name: 'q-600-974549454-20260902.wav', isDirectory: false, size: 1048576 }
                                ]
                            }
                        }
                    }
                }
            }
        },
        '/api/recordings/stream': {
            get: {
                tags: ['Audio Explorer'],
                summary: 'Audio faylni stream qilish (tinglash)',
                description: 'SFTP orqali audio faylni to\'g\'ridan-to\'g\'ri brauzer audio pleyeriga HTTP stream (Range requests) qilib uzatadi.',
                parameters: [
                    {
                        name: 'file',
                        in: 'query',
                        required: true,
                        description: 'Audio faylning monitor papkasidagi nisbiy yo\'li',
                        schema: { type: 'string', example: '2026/09/02/q-600-974549454-1788346537.wav' }
                    }
                ],
                responses: {
                    200: {
                        description: 'Audio stream (audio/wav yoki audio/mpeg)',
                        content: {
                            'audio/wav': {}
                        }
                    },
                    400: {
                        description: 'file parametri berilmagan'
                    }
                }
            }
        },
        '/api/action/originate': {
            post: {
                tags: ['Telephony Actions'],
                summary: 'Yangi qo\'ng\'iroqni boshlash (Click-to-Call)',
                description: 'Asterisk AMI orqali operator va mijoz o\'rtasida qo\'ng\'iroq ulaydi.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['from', 'to'],
                                properties: {
                                    from: {
                                        type: 'string',
                                        description: 'Operator ichki raqami',
                                        example: '103'
                                    },
                                    to: {
                                        type: 'string',
                                        description: 'Qo\'ng\'iroq qilinayotgan mijoz raqami',
                                        example: '974549454'
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        description: 'Qo\'ng\'iroq AMI orqali yuborildi',
                        content: {
                            'application/json': {
                                example: {
                                    success: true,
                                    response: { Response: 'Success', Message: 'Originate successfully queued' }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/action/transfer': {
            post: {
                tags: ['Telephony Actions'],
                summary: 'Qo\'ng\'iroqni boshqa operatorga yo\'naltirish',
                description: 'Ayni paytdagi suhbat kanalini boshqa operator raqamiga transfer qiladi.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['channel', 'targetExten'],
                                properties: {
                                    channel: {
                                        type: 'string',
                                        example: 'SIP/103-00000a12'
                                    },
                                    targetExten: {
                                        type: 'string',
                                        example: '101'
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        description: 'Transfer buyrug\'i qabul qilindi'
                    }
                }
            }
        },
        '/api/action/hangup': {
            post: {
                tags: ['Telephony Actions'],
                summary: 'Kanalni majburan uzish (Hangup)',
                description: 'Faol kanalni to\'xtatadi va aloqani uzadi.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['channel'],
                                properties: {
                                    channel: {
                                        type: 'string',
                                        example: 'SIP/103-00000a12'
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        description: 'Kanal muvaffaqiyatli uzildi'
                    }
                }
            }
        }
    }
};
