/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/rents_ticketing.json`.
 */
export type RentsTicketing = {
  "address": "E92DmfyvMfLBWs9TqzFzN11khwxopKEvCKPoD3jY9zhw",
  "metadata": {
    "name": "rentsTicketing",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "cancelListing",
      "discriminator": [
        41,
        183,
        50,
        232,
        230,
        233,
        157,
        70
      ],
      "accounts": [
        {
          "name": "holder",
          "signer": true
        },
        {
          "name": "ticket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  99,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "ticket.mint",
                "account": "ticket"
              }
            ]
          }
        },
        {
          "name": "tokenAccount"
        }
      ],
      "args": []
    },
    {
      "name": "checkInTicket",
      "discriminator": [
        174,
        66,
        18,
        131,
        231,
        120,
        103,
        246
      ],
      "accounts": [
        {
          "name": "organizer",
          "signer": true
        },
        {
          "name": "event",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  118,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "event.organizer",
                "account": "event"
              },
              {
                "kind": "account",
                "path": "event.eventId",
                "account": "event"
              }
            ]
          }
        },
        {
          "name": "ticket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  99,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "ticket.mint",
                "account": "ticket"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "holder"
        },
        {
          "name": "tokenAccount"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "initializeEvent",
      "discriminator": [
        126,
        249,
        86,
        221,
        202,
        171,
        134,
        20
      ],
      "accounts": [
        {
          "name": "organizer",
          "writable": true,
          "signer": true
        },
        {
          "name": "event",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  118,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "organizer"
              },
              {
                "kind": "arg",
                "path": "eventId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "eventId",
          "type": "u64"
        },
        {
          "name": "maxTickets",
          "type": "u32"
        },
        {
          "name": "basePrice",
          "type": "u64"
        },
        {
          "name": "resaleCapBps",
          "type": "u16"
        },
        {
          "name": "royaltyBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initializePlatformConfig",
      "discriminator": [
        23,
        52,
        237,
        53,
        176,
        235,
        3,
        187
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "platformConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "platformWallet",
          "type": "pubkey"
        },
        {
          "name": "platformFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "listTicket",
      "discriminator": [
        11,
        213,
        240,
        45,
        246,
        35,
        44,
        162
      ],
      "accounts": [
        {
          "name": "holder",
          "signer": true
        },
        {
          "name": "event",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  118,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "event.organizer",
                "account": "event"
              },
              {
                "kind": "account",
                "path": "event.eventId",
                "account": "event"
              }
            ]
          }
        },
        {
          "name": "ticket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  99,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "ticket.mint",
                "account": "ticket"
              }
            ]
          }
        },
        {
          "name": "tokenAccount"
        }
      ],
      "args": [
        {
          "name": "price",
          "type": "u64"
        }
      ]
    },
    {
      "name": "mintTicket",
      "discriminator": [
        159,
        167,
        223,
        60,
        138,
        6,
        23,
        29
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "event",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  118,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "event.organizer",
                "account": "event"
              },
              {
                "kind": "account",
                "path": "event.eventId",
                "account": "event"
              }
            ]
          }
        },
        {
          "name": "organizer",
          "writable": true
        },
        {
          "name": "platformConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "platformWallet",
          "writable": true
        },
        {
          "name": "ticketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true,
          "signer": true
        },
        {
          "name": "ticket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  99,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "buyerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "metadata",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "tokenMetadataProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                11,
                112,
                101,
                177,
                227,
                209,
                124,
                69,
                56,
                157,
                82,
                127,
                107,
                4,
                195,
                205,
                88,
                184,
                108,
                115,
                26,
                160,
                253,
                181,
                73,
                182,
                209,
                188,
                3,
                248,
                41,
                70
              ]
            }
          }
        },
        {
          "name": "tokenMetadataProgram",
          "address": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "eventName",
          "type": "string"
        },
        {
          "name": "uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "resellTicket",
      "discriminator": [
        129,
        5,
        148,
        113,
        63,
        25,
        240,
        226
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "event",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  118,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "event.organizer",
                "account": "event"
              },
              {
                "kind": "account",
                "path": "event.eventId",
                "account": "event"
              }
            ]
          }
        },
        {
          "name": "ticket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  99,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "ticket.mint",
                "account": "ticket"
              }
            ]
          }
        },
        {
          "name": "organizer",
          "writable": true
        },
        {
          "name": "seller",
          "writable": true
        },
        {
          "name": "platformConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "platformWallet",
          "writable": true
        },
        {
          "name": "ticketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "sellerTokenAccount",
          "writable": true
        },
        {
          "name": "buyerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "updatePlatformFee",
      "discriminator": [
        162,
        97,
        186,
        47,
        93,
        113,
        176,
        243
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "platformConfig"
          ]
        },
        {
          "name": "platformConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "updatePlatformWallet",
      "discriminator": [
        76,
        183,
        6,
        58,
        132,
        56,
        171,
        156
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "platformConfig"
          ]
        },
        {
          "name": "platformConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newPlatformWallet",
          "type": "pubkey"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "event",
      "discriminator": [
        125,
        192,
        125,
        158,
        9,
        115,
        152,
        233
      ]
    },
    {
      "name": "platformConfig",
      "discriminator": [
        160,
        78,
        128,
        0,
        248,
        83,
        230,
        160
      ]
    },
    {
      "name": "ticket",
      "discriminator": [
        41,
        228,
        24,
        165,
        78,
        90,
        235,
        200
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "priceExceedsCap",
      "msg": "Resale price exceeds the allowed cap."
    },
    {
      "code": 6001,
      "name": "alreadyCheckedIn",
      "msg": "Ticket has already been checked in"
    },
    {
      "code": 6002,
      "name": "soldOut",
      "msg": "Event has sold out."
    },
    {
      "code": 6003,
      "name": "invalidOrganizer",
      "msg": "Provided organizer does not match the events organizer."
    },
    {
      "code": 6004,
      "name": "mathOverFlow",
      "msg": "Arithmetic overflow while computing fees."
    },
    {
      "code": 6005,
      "name": "unauthorized",
      "msg": "Only the platform config authority can perform this action."
    },
    {
      "code": 6006,
      "name": "notAdmin",
      "msg": "Only the platform config admin can perform this action."
    },
    {
      "code": 6007,
      "name": "invalidFee",
      "msg": "Platform fee cannot exceed 500 basis points."
    },
    {
      "code": 6008,
      "name": "notTicketOwner",
      "msg": "Provided seller is not the current owner of this ticket."
    },
    {
      "code": 6009,
      "name": "invalidBps",
      "msg": "Invalid basis-point value."
    },
    {
      "code": 6010,
      "name": "invalidPrice",
      "msg": "Price must be greater than zero."
    },
    {
      "code": 6011,
      "name": "notListed",
      "msg": "Ticket is not listed for resale."
    },
    {
      "code": 6012,
      "name": "ticketAlreadyUsed",
      "msg": "Ticket has already been used."
    },
    {
      "code": 6013,
      "name": "notTicketHolder",
      "msg": "Signer is not the current ticket holder."
    },
    {
      "code": 6014,
      "name": "notEventOrganizer",
      "msg": "Signer is not the event organizer."
    },
    {
      "code": 6015,
      "name": "selfPurchase",
      "msg": "Ticket cannot be purchased by its current owner."
    },
    {
      "code": 6016,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow while computing values."
    },
    {
      "code": 6017,
      "name": "wrongEvent",
      "msg": "Ticket does not belong to the specified event."
    },
    {
      "code": 6018,
      "name": "invalidMaxTickets",
      "msg": "Maximum ticket count must be greater than zero."
    }
  ],
  "types": [
    {
      "name": "event",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "organizer",
            "type": "pubkey"
          },
          {
            "name": "eventId",
            "type": "u64"
          },
          {
            "name": "maxTickets",
            "type": "u32"
          },
          {
            "name": "ticketsSold",
            "type": "u32"
          },
          {
            "name": "basePrice",
            "type": "u64"
          },
          {
            "name": "resaleCapBps",
            "type": "u16"
          },
          {
            "name": "royaltyBps",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "platformConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "platformWallet",
            "type": "pubkey"
          },
          {
            "name": "platformFeeBps",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "ticket",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "event",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "ticketNumber",
            "type": "u32"
          },
          {
            "name": "faceValue",
            "type": "u64"
          },
          {
            "name": "isUsed",
            "type": "bool"
          },
          {
            "name": "usedAt",
            "type": "i64"
          },
          {
            "name": "listingPrice",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "resaleCount",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
