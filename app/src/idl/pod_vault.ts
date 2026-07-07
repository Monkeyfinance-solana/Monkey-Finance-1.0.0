/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `app/src/idl/pod_vault.json`.
 *
 * This is a checked-in copy of Anchor's generated `target/types/pod_vault.ts`
 * (that directory is gitignored, so it never reaches Vercel's build). After
 * running `anchor build` again, re-copy the freshly generated
 * `target/idl/pod_vault.json` and `target/types/pod_vault.ts` over these two
 * files so the deployed front-end stays in sync with the on-chain program.
 */
export type PodVault = {
  "address": "2A2iyfJ7Fr1PzQiz8crgmGn5MdBcyXaGrffppSz4C5ZD",
  "metadata": {
    "name": "podVault",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Peapod-style wrap/unwrap vault: swap TKN <-> bTKN 1:1 minus a protocol fee."
  },
  "instructions": [
    {
      "name": "acceptAuthority",
      "docs": [
        "Step 2 of 2: must be signed by the currently-pending authority.",
        "Completes the transfer nominated by `propose_authority`."
      ],
      "discriminator": [
        107,
        86,
        198,
        91,
        33,
        12,
        107,
        160
      ],
      "accounts": [
        {
          "name": "newAuthority",
          "signer": true
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "cancelAuthorityTransfer",
      "docs": [
        "Authority-only: cancels a pending authority transfer before it's",
        "been accepted."
      ],
      "discriminator": [
        94,
        131,
        125,
        184,
        183,
        24,
        125,
        229
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "claimBtknRewards",
      "docs": [
        "Claim accrued bTKN-staking rewards without unstaking."
      ],
      "discriminator": [
        42,
        115,
        218,
        254,
        158,
        81,
        76,
        180
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        },
        {
          "name": "rewardVaultTokenAccount",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "userRewardTokenAccount",
          "writable": true
        },
        {
          "name": "stakeInfo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  116,
                  107,
                  110,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "claimRewards",
      "docs": [
        "Claim accrued rewards without unstaking."
      ],
      "discriminator": [
        4,
        144,
        132,
        71,
        116,
        23,
        151,
        80
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        },
        {
          "name": "rewardVaultTokenAccount",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "userRewardTokenAccount",
          "writable": true
        },
        {
          "name": "stakeInfo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "initializeVault",
      "docs": [
        "Creates a new vault (\"pod\") for a given TKN mint, and creates the",
        "bTKN mint that this vault will control. Call this once per TKN.",
        "",
        "`btkn_name`/`btkn_symbol`/`btkn_uri` become bTKN's own Metaplex",
        "metadata, created atomically in this same instruction (see",
        "`instructions::initialize`). To have bTKN display the same image as",
        "TKN, the caller should fetch TKN's existing metadata off-chain and",
        "pass its `uri` straight through (see `scripts/init_vault.ts`)."
      ],
      "discriminator": [
        48,
        191,
        163,
        44,
        71,
        129,
        63,
        164
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "tknMint",
          "docs": [
            "The underlying token (TKN) this pod wraps. This should already exist",
            "(e.g. the mint you got back from launching TKN on pump.fun)."
          ]
        },
        {
          "name": "protocolTokenAccount",
          "docs": [
            "Destination for the protocol-revenue share of fees (see",
            "`protocol_bps`) -- must already exist and hold TKN (e.g. an ATA of",
            "the vault deployer's own wallet). Required even if protocol_bps is",
            "0 at first, so `set_protocol_wallet`/`update_fees` never have to deal",
            "with an unset destination. Changeable later via `set_protocol_wallet`."
          ]
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tknMint"
              }
            ]
          }
        },
        {
          "name": "btknMint",
          "docs": [
            "The wrapped token (bTKN), minted 1:1 against deposits. The vault PDA",
            "itself is the mint authority, so only this program can ever mint it."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  116,
                  107,
                  110,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tknMint"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "docs": [
            "Vault's holding account for deposited TKN, owned by the vault PDA.",
            "This backs bTKN 1:1 -- fees never touch it."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  107,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "tknMint"
              }
            ]
          }
        },
        {
          "name": "rewardVaultTokenAccount",
          "docs": [
            "Holds the LP-reward share of collected fees until stakers claim it.",
            "(A plain PDA-owned token account, not an ATA -- an ATA would collide",
            "with vault_token_account since both hold the same mint under the",
            "same owner.)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tknMint"
              }
            ]
          }
        },
        {
          "name": "stakedBtknVault",
          "docs": [
            "Holds staked bTKN in custody for the bTKN-staking pool. Created here",
            "(unlike staked_lp_vault, which waits for `set_lp_mint`) since bTKN's",
            "mint is already known -- bTKN staking works from the moment the vault",
            "exists, no external pool required."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  100,
                  95,
                  98,
                  116,
                  107,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "tknMint"
              }
            ]
          }
        },
        {
          "name": "btknMetadata",
          "docs": [
            "Unallocated Metaplex Metadata PDA for bTKN -- created via CPI inside",
            "the handler so bTKN can carry the same name/symbol/image as TKN from",
            "the moment it's minted. Anchor only validates the address here (via",
            "`seeds`/`seeds::program`); the account is actually created by the",
            "`CreateV1` CPI below, not by an `init` constraint, since Anchor",
            "doesn't know how to initialize another program's account type.",
            "against the real Metaplex Token Metadata program; contents are",
            "written by that program via the CPI in the handler, not by us."
          ],
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
                "path": "btknMint"
              }
            ],
            "program": {
              "kind": "account",
              "path": "tokenMetadataProgram"
            }
          }
        },
        {
          "name": "tokenMetadataProgram",
          "docs": [
            "program id (`metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`); this is",
            "the program being CPI'd into, not our data. Hardcoded via `Pubkey`'s",
            "`FromStr` (base58) parsing rather than `mpl_token_metadata::ID`",
            "directly, since that constant is a `Pubkey` from a different",
            "(incompatible, separately-versioned) copy of the solana-pubkey crate",
            "than the one anchor-lang uses here -- comparing the two directly is a",
            "type error, not just a style choice. Also avoids the `pubkey!` macro,",
            "whose path isn't resolvable in this crate-version combination."
          ]
        },
        {
          "name": "sysvarInstructions",
          "docs": [
            "address (`Sysvar1nstructions1111111111111111111111111`), required by",
            "Metaplex's `CreateV1` instruction (used for instruction introspection",
            "on their end), not read by us. Hardcoded via `Pubkey`'s `FromStr`",
            "parsing (see `token_metadata_program` above for why)."
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "wrapFeeBps",
          "type": "u16"
        },
        {
          "name": "unwrapFeeBps",
          "type": "u16"
        },
        {
          "name": "burnBps",
          "type": "u16"
        },
        {
          "name": "protocolBps",
          "type": "u16"
        },
        {
          "name": "btknShareBps",
          "type": "u16"
        },
        {
          "name": "btknName",
          "type": "string"
        },
        {
          "name": "btknSymbol",
          "type": "string"
        },
        {
          "name": "btknUri",
          "type": "string"
        }
      ]
    },
    {
      "name": "proposeAuthority",
      "docs": [
        "Authority-only, step 1 of 2: nominate a new authority. Takes no",
        "effect until the nominated address signs `accept_authority`."
      ],
      "discriminator": [
        20,
        148,
        236,
        198,
        76,
        119,
        99,
        142
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        },
        {
          "name": "newAuthority"
        }
      ],
      "args": []
    },
    {
      "name": "resetLpMint",
      "docs": [
        "Authority-only, only while total_staked == 0: closes the current",
        "staked-LP vault and clears lp_mint, so `set_lp_mint` can be called",
        "again with a corrected address. Lets you recover from pointing the",
        "vault at the wrong LP mint, as long as nobody's staked yet."
      ],
      "discriminator": [
        233,
        105,
        195,
        139,
        20,
        143,
        241,
        75
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        },
        {
          "name": "stakedLpVault",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "setLpMint",
      "docs": [
        "Authority-only, once per vault: point it at the bTKN/SOL (or",
        "whatever pair) pool's LP mint so LPs can stake it for rewards."
      ],
      "discriminator": [
        189,
        11,
        158,
        122,
        176,
        207,
        231,
        132
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        },
        {
          "name": "lpMint"
        },
        {
          "name": "stakedLpVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  100,
                  95,
                  108,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "setPaused",
      "docs": [
        "Authority-only emergency switch: while paused, `wrap` and `unwrap`",
        "are blocked (staking/unstaking/claiming are NOT affected, since",
        "letting people withdraw their own funds is safe even mid-incident).",
        "This buys time to investigate a bug without needing to redeploy."
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setProtocolWallet",
      "docs": [
        "Authority-only: repoint the protocol-revenue destination account."
      ],
      "discriminator": [
        118,
        54,
        197,
        41,
        122,
        139,
        65,
        174
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        },
        {
          "name": "protocolTokenAccount"
        }
      ],
      "args": []
    },
    {
      "name": "stakeBtkn",
      "docs": [
        "Stake bTKN directly to earn a share of fees -- the option for",
        "holders who don't want to provide/stake LP. Works immediately, with",
        "no dependency on an external pool existing."
      ],
      "discriminator": [
        153,
        39,
        88,
        228,
        17,
        34,
        169,
        216
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        },
        {
          "name": "btknMint",
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "stakedBtknVault",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "rewardVaultTokenAccount",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "userBtknAccount",
          "writable": true
        },
        {
          "name": "userRewardTokenAccount",
          "writable": true
        },
        {
          "name": "stakeInfo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  116,
                  107,
                  110,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "stakeLp",
      "docs": [
        "Stake your bTKN/SOL LP token to start earning a share of fees."
      ],
      "discriminator": [
        48,
        168,
        125,
        78,
        82,
        71,
        152,
        117
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        },
        {
          "name": "lpMint",
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "stakedLpVault",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "rewardVaultTokenAccount",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "userLpTokenAccount",
          "writable": true
        },
        {
          "name": "userRewardTokenAccount",
          "writable": true
        },
        {
          "name": "stakeInfo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "unstakeBtkn",
      "docs": [
        "Unstake bTKN, automatically claiming any pending reward first."
      ],
      "discriminator": [
        179,
        159,
        108,
        172,
        42,
        59,
        119,
        74
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        },
        {
          "name": "btknMint",
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "stakedBtknVault",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "rewardVaultTokenAccount",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "userBtknAccount",
          "writable": true
        },
        {
          "name": "userRewardTokenAccount",
          "writable": true
        },
        {
          "name": "stakeInfo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  116,
                  107,
                  110,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "unstakeLp",
      "docs": [
        "Unstake LP tokens, automatically claiming any pending reward first."
      ],
      "discriminator": [
        114,
        4,
        7,
        206,
        251,
        176,
        233,
        119
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        },
        {
          "name": "lpMint",
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "stakedLpVault",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "rewardVaultTokenAccount",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "userLpTokenAccount",
          "writable": true
        },
        {
          "name": "userRewardTokenAccount",
          "writable": true
        },
        {
          "name": "stakeInfo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "unwrap",
      "docs": [
        "Burn `amount` bTKN, receive (amount - fee) TKN back. Same fee split",
        "as wrap, using unwrap_fee_bps instead."
      ],
      "discriminator": [
        126,
        175,
        198,
        14,
        212,
        69,
        50,
        44
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        },
        {
          "name": "tknMint",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "btknMint",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "vaultTokenAccount",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "rewardVaultTokenAccount",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "protocolTokenAccount",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "userTknAccount",
          "writable": true
        },
        {
          "name": "userBtknAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateFees",
      "docs": [
        "Authority-only: change the wrap fee, unwrap fee, and how each fee is",
        "split between burn / protocol revenue / bTKN stakers / LP stakers."
      ],
      "discriminator": [
        225,
        27,
        13,
        6,
        69,
        84,
        172,
        191
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "wrapFeeBps",
          "type": "u16"
        },
        {
          "name": "unwrapFeeBps",
          "type": "u16"
        },
        {
          "name": "burnBps",
          "type": "u16"
        },
        {
          "name": "protocolBps",
          "type": "u16"
        },
        {
          "name": "btknShareBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "wrap",
      "docs": [
        "Deposit `amount` TKN, receive (amount - fee) bTKN. A share of the",
        "fee (`burn_bps`) is burned; the rest funds staker rewards, split",
        "between LP stakers and bTKN stakers per `btkn_share_bps`."
      ],
      "discriminator": [
        178,
        40,
        10,
        189,
        228,
        129,
        186,
        140
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vaultConfig.tknMint",
                "account": "vaultConfig"
              }
            ]
          }
        },
        {
          "name": "tknMint",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "btknMint",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "vaultTokenAccount",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "rewardVaultTokenAccount",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "protocolTokenAccount",
          "writable": true,
          "relations": [
            "vaultConfig"
          ]
        },
        {
          "name": "userTknAccount",
          "writable": true
        },
        {
          "name": "userBtknAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "btknMint"
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
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "stakeInfo",
      "discriminator": [
        66,
        62,
        68,
        70,
        108,
        179,
        183,
        235
      ]
    },
    {
      "name": "vaultConfig",
      "discriminator": [
        99,
        86,
        43,
        216,
        184,
        102,
        119,
        77
      ]
    }
  ],
  "events": [
    {
      "name": "authorityProposedEvent",
      "discriminator": [
        221,
        27,
        73,
        198,
        252,
        169,
        231,
        224
      ]
    },
    {
      "name": "authorityTransferCancelledEvent",
      "discriminator": [
        192,
        121,
        140,
        224,
        229,
        96,
        13,
        143
      ]
    },
    {
      "name": "authorityUpdatedEvent",
      "discriminator": [
        44,
        40,
        20,
        115,
        145,
        198,
        95,
        200
      ]
    },
    {
      "name": "btknRewardPaidEvent",
      "discriminator": [
        178,
        241,
        102,
        100,
        246,
        229,
        229,
        169
      ]
    },
    {
      "name": "btknStakeEvent",
      "discriminator": [
        15,
        4,
        113,
        24,
        236,
        32,
        230,
        210
      ]
    },
    {
      "name": "btknUnstakeEvent",
      "discriminator": [
        19,
        93,
        106,
        111,
        5,
        167,
        230,
        76
      ]
    },
    {
      "name": "feesUpdatedEvent",
      "discriminator": [
        132,
        181,
        254,
        193,
        136,
        177,
        41,
        20
      ]
    },
    {
      "name": "lpMintResetEvent",
      "discriminator": [
        47,
        19,
        79,
        177,
        1,
        253,
        131,
        136
      ]
    },
    {
      "name": "lpMintSetEvent",
      "discriminator": [
        86,
        118,
        127,
        191,
        2,
        7,
        31,
        204
      ]
    },
    {
      "name": "pausedSetEvent",
      "discriminator": [
        210,
        246,
        187,
        173,
        5,
        193,
        142,
        20
      ]
    },
    {
      "name": "protocolWalletSetEvent",
      "discriminator": [
        253,
        117,
        163,
        161,
        191,
        167,
        148,
        192
      ]
    },
    {
      "name": "rewardPaidEvent",
      "discriminator": [
        209,
        35,
        148,
        7,
        238,
        232,
        124,
        53
      ]
    },
    {
      "name": "stakeEvent",
      "discriminator": [
        226,
        134,
        188,
        173,
        19,
        33,
        75,
        175
      ]
    },
    {
      "name": "unstakeEvent",
      "discriminator": [
        162,
        104,
        137,
        228,
        81,
        3,
        79,
        197
      ]
    },
    {
      "name": "unwrapEvent",
      "discriminator": [
        73,
        129,
        203,
        215,
        50,
        111,
        179,
        20
      ]
    },
    {
      "name": "wrapEvent",
      "discriminator": [
        148,
        134,
        198,
        142,
        20,
        51,
        173,
        180
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "feeTooHigh",
      "msg": "Fee exceeds maximum allowed (3%)"
    },
    {
      "code": 6001,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6002,
      "name": "amountBelowFee",
      "msg": "Amount too small: fee consumes entire output"
    },
    {
      "code": 6003,
      "name": "unauthorized",
      "msg": "Only the vault authority can perform this action"
    },
    {
      "code": 6004,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6005,
      "name": "lpMintAlreadySet",
      "msg": "LP mint has already been set for this vault"
    },
    {
      "code": 6006,
      "name": "insufficientStake",
      "msg": "Not enough staked to unstake that amount"
    },
    {
      "code": 6007,
      "name": "vaultPaused",
      "msg": "wrap/unwrap are paused on this vault"
    },
    {
      "code": 6008,
      "name": "cannotResetWhileStaked",
      "msg": "Cannot reset the LP mint while stakers are still staked"
    },
    {
      "code": 6009,
      "name": "lpMintNotSet",
      "msg": "No LP mint has been set for this vault yet"
    },
    {
      "code": 6010,
      "name": "invalidNewAuthority",
      "msg": "New authority cannot be the default/zero pubkey"
    },
    {
      "code": 6011,
      "name": "noPendingAuthorityTransfer",
      "msg": "No authority transfer is currently pending for this vault"
    },
    {
      "code": 6012,
      "name": "notThePendingAuthority",
      "msg": "Only the pending authority can accept this transfer"
    },
    {
      "code": 6013,
      "name": "feeSplitExceedsTotal",
      "msg": "burn_bps + protocol_bps + btkn_share_bps cannot exceed 10_000 (100% of the fee)"
    },
    {
      "code": 6014,
      "name": "protocolWalletNotSet",
      "msg": "protocol_bps is nonzero but no protocol wallet has been set -- call set_protocol_wallet first"
    },
    {
      "code": 6015,
      "name": "metadataFieldTooLong",
      "msg": "bTKN name/symbol/uri exceeds Metaplex's max length for that field"
    }
  ],
  "types": [
    {
      "name": "authorityProposedEvent",
      "docs": [
        "Emitted when the authority proposes a transfer via `propose_authority`.",
        "The transfer isn't in effect yet -- `authority` on VaultConfig is",
        "unchanged until the proposed address calls `accept_authority`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "currentAuthority",
            "type": "pubkey"
          },
          {
            "name": "proposedAuthority",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "authorityTransferCancelledEvent",
      "docs": [
        "Emitted when a pending authority transfer is cancelled via",
        "`cancel_authority_transfer`, before it was ever accepted."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "cancelledPendingAuthority",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "authorityUpdatedEvent",
      "docs": [
        "Emitted once the proposed authority actually accepts, via",
        "`accept_authority` -- this is the point the transfer takes effect."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "oldAuthority",
            "type": "pubkey"
          },
          {
            "name": "newAuthority",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "btknRewardPaidEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "btknStakeEvent",
      "docs": [
        "Same shape as StakeEvent/UnstakeEvent/RewardPaidEvent, emitted for the",
        "bTKN-staker pool instead of the LP-staker pool."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalBtknStaked",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "btknUnstakeEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalBtknStaked",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "feesUpdatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "wrapFeeBps",
            "type": "u16"
          },
          {
            "name": "unwrapFeeBps",
            "type": "u16"
          },
          {
            "name": "burnBps",
            "type": "u16"
          },
          {
            "name": "protocolBps",
            "type": "u16"
          },
          {
            "name": "btknShareBps",
            "type": "u16"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "lpMintResetEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "lpMintSetEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "lpMint",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "pausedSetEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "protocolWalletSetEvent",
      "docs": [
        "Emitted whenever the protocol-revenue destination account is set/changed",
        "via `set_protocol_wallet`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "protocolTokenAccount",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "rewardPaidEvent",
      "docs": [
        "Emitted any time a pending reward is actually paid out -- whether that",
        "happened via an explicit `claim_rewards` call, or as the automatic",
        "settle-before-you-change-your-stake step inside `stake_lp`/`unstake_lp`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "stakeEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalStaked",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "stakeInfo",
      "docs": [
        "Shared shape for both staking pools: LP stakers (PDA seeds `[\"stake\", ...]`)",
        "and bTKN stakers (PDA seeds `[\"btkn_stake\", ...]`) each get their own",
        "StakeInfo account, keyed by their own seed prefix, pointed at their own",
        "accumulator on VaultConfig."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "rewardDebt",
            "type": "u128"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "totalClaimed",
            "docs": [
              "Cumulative TKN this staker has ever been paid, across every",
              "stake/unstake/claim that triggered a payout. Read this directly to",
              "answer \"how much have I gained so far\" without needing to replay",
              "event history."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "unstakeEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalStaked",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "unwrapEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "btknBurned",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "burned",
            "type": "u64"
          },
          {
            "name": "toProtocol",
            "type": "u64"
          },
          {
            "name": "toRewardPot",
            "type": "u64"
          },
          {
            "name": "toBtknRewardPot",
            "type": "u64"
          },
          {
            "name": "tknReleased",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "vaultConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "pendingAuthority",
            "docs": [
              "Set by `propose_authority`, cleared by `accept_authority` or",
              "`cancel_authority_transfer`. Pubkey::default() means \"no transfer",
              "pending\". Two-step so a mistyped/unreachable address can never",
              "permanently strip control of the vault -- the new authority must",
              "actively sign `accept_authority` before the change takes effect."
            ],
            "type": "pubkey"
          },
          {
            "name": "tknMint",
            "type": "pubkey"
          },
          {
            "name": "btknMint",
            "type": "pubkey"
          },
          {
            "name": "vaultTokenAccount",
            "type": "pubkey"
          },
          {
            "name": "rewardVaultTokenAccount",
            "docs": [
              "Holds the LP-reward share of collected fees until stakers claim it."
            ],
            "type": "pubkey"
          },
          {
            "name": "lpMint",
            "docs": [
              "The bTKN/SOL (or whatever pair) LP token from an external AMM.",
              "Pubkey::default() until `set_lp_mint` is called, since the pool",
              "is usually created after the vault itself."
            ],
            "type": "pubkey"
          },
          {
            "name": "stakedLpVault",
            "docs": [
              "Holds staked LP tokens in custody. Pubkey::default() until",
              "`set_lp_mint` is called."
            ],
            "type": "pubkey"
          },
          {
            "name": "stakedBtknVault",
            "docs": [
              "Holds staked bTKN tokens in custody. Created at `initialize_vault`",
              "time (unlike staked_lp_vault) since the bTKN mint is already known",
              "up front -- bTKN staking has no external-pool dependency, so it can",
              "be used the moment someone wraps, with no bootstrap step."
            ],
            "type": "pubkey"
          },
          {
            "name": "protocolTokenAccount",
            "docs": [
              "Destination for the protocol-revenue share of each fee (see",
              "`protocol_bps`). A plain TokenAccount (TKN mint) that the team",
              "controls -- e.g. an ATA of the vault deployer's own wallet. Set at",
              "`initialize_vault` time and changeable later via `set_protocol_wallet`."
            ],
            "type": "pubkey"
          },
          {
            "name": "wrapFeeBps",
            "type": "u16"
          },
          {
            "name": "unwrapFeeBps",
            "type": "u16"
          },
          {
            "name": "burnBps",
            "docs": [
              "Every one of burn_bps/protocol_bps/btkn_share_bps below is a direct",
              "% *of the fee itself* (not nested/sequential -- e.g. burn_bps = 2000",
              "means 20% of the fee is burned, independent of the other splits).",
              "Their sum must be <= 10_000; whatever's left over implicitly goes to",
              "the LP-staker reward pot, so the four buckets (burn, protocol, bTKN",
              "stakers, LP stakers) always account for exactly 100% of the fee.",
              "",
              "% of each collected fee that gets burned."
            ],
            "type": "u16"
          },
          {
            "name": "protocolBps",
            "docs": [
              "% of each collected fee routed to `protocol_token_account`. Requires",
              "`protocol_token_account` to already be set -- see `set_protocol_wallet`."
            ],
            "type": "u16"
          },
          {
            "name": "btknShareBps",
            "docs": [
              "% of each collected fee that goes to the bTKN-staker reward pot",
              "(rather than the LP-staker reward pot). Orthogonal to burn_bps/",
              "protocol_bps."
            ],
            "type": "u16"
          },
          {
            "name": "accRewardPerShare",
            "docs": [
              "Accumulator (scaled by SCALE) used for O(1) reward accounting,",
              "MasterChef-style: each staker's pending reward is",
              "`amount * acc_reward_per_share / SCALE - reward_debt`."
            ],
            "type": "u128"
          },
          {
            "name": "accBtknRewardPerShare",
            "docs": [
              "Same idea as acc_reward_per_share, but for the bTKN-staker pool."
            ],
            "type": "u128"
          },
          {
            "name": "totalStaked",
            "type": "u64"
          },
          {
            "name": "totalBtknStaked",
            "docs": [
              "Total bTKN currently staked (locked in staked_btkn_vault)."
            ],
            "type": "u64"
          },
          {
            "name": "totalWrapped",
            "type": "u64"
          },
          {
            "name": "totalUnwrapped",
            "type": "u64"
          },
          {
            "name": "totalBurned",
            "docs": [
              "Cumulative TKN burned by this vault since inception. Read this",
              "directly (no indexer needed) for a \"total burned\" stat."
            ],
            "type": "u64"
          },
          {
            "name": "totalRewardDistributed",
            "docs": [
              "Cumulative TKN ever routed into the LP-staker reward pot (whether",
              "claimed yet or not)."
            ],
            "type": "u64"
          },
          {
            "name": "totalBtknRewardDistributed",
            "docs": [
              "Same, for the bTKN-staker reward pot."
            ],
            "type": "u64"
          },
          {
            "name": "totalProtocolDistributed",
            "docs": [
              "Cumulative TKN ever sent to `protocol_token_account`."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "btknMintBump",
            "type": "u8"
          },
          {
            "name": "paused",
            "docs": [
              "Emergency switch. While true, `wrap`/`unwrap` are blocked. Does NOT",
              "affect staking/unstaking/claiming -- letting people withdraw their",
              "own funds is safe even mid-incident."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "wrapEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfig",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amountIn",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "burned",
            "type": "u64"
          },
          {
            "name": "toProtocol",
            "type": "u64"
          },
          {
            "name": "toRewardPot",
            "type": "u64"
          },
          {
            "name": "toBtknRewardPot",
            "type": "u64"
          },
          {
            "name": "btknMinted",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
