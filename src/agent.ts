import {
  Finding,
  Initialize,
  HandleTransaction,
  HandleAlert,
  AlertEvent,
  TransactionEvent,
  FindingSeverity,
  FindingType,
  EntityType,
} from "forta-agent";
import { JsonStorage } from "forta-helpers";

import {
  findPastScamTokens,
  getERC20Holders,
  initializeMulticalls,
} from "./helpers";
type BotState = {
  scamTokens: string[];
  updatedAt: string;
  spammerAddresses: { [key: string]: number };
};

const SandboxAddresses = {
  1: {
    sand: "0x3845badAde8e6dFF049820680d1F14bD3903a5d0",
    land: "0x5CC5B05a8A13E3fBDB0BB9FcCd98D38e50F90c38",
  },
  137: {
    sand: "0xbbba073c31bf03b8acf7c28ef0738decf3695683",
    land: "0x9d305a42A3975Ee4c1C57555BeD5919889DCE63F",
  },
};

export const ERC20_ERC721_TRANSFER_EVENT =
  "event Transfer(address indexed from, address indexed to, uint256 value)";
export const ERC1155_TRANSFER_EVENT =
  "event TransferSingle(address indexed _operator, address indexed _from, address indexed _to, uint256 _id, uint256 _value)";

let findingsCount = 0;

const handleTransaction: HandleTransaction = async (
  txEvent: TransactionEvent
) => {
  // handlers.
  txEvent.logs.forEach(
    (log, idx) =>
      (txEvent.logs[idx].data =
        log.data == "0x"
          ? "0x0000000000000000000000000000000000000000000000000000000000000000"
          : log.data)
  );
  const findings: Finding[] = [];
  const stateStorage = new JsonStorage<BotState>("./data", "state.json");
  let state = await stateStorage.read();

  // filter the transaction logs for Tether transfer events
  const scamTokenTransferEvents = txEvent.filterLog(
    [ERC20_ERC721_TRANSFER_EVENT, ERC1155_TRANSFER_EVENT],
    state?.scamTokens
  );

  const receivers = scamTokenTransferEvents.map((transferEvent) => {
    return {
      scamToken: transferEvent.address,
      receiver: transferEvent.args.to,
      sender: transferEvent.args.from,
    };
  });

  console.log("Received ", receivers.length, " spam tokens");
  if (txEvent.network == 1 || txEvent.network == 137) {
    const accountsChecked = await getERC20Holders(
      SandboxAddresses[1].sand,
      SandboxAddresses[137].sand,
      receivers.map((r) => r.receiver)
    );

    await accountsChecked.forEach(async (account, idx) => {
      if (account.isHolder) {
        const newStorageState = { ...state };
        if (newStorageState.spammerAddresses?.[receivers[idx].sender]) {
          newStorageState.spammerAddresses[receivers[idx].sender] += 1;
        } else {
          Object.defineProperty(
            newStorageState.spammerAddresses,
            receivers[idx].sender,
            {
              enumerable: true,
              value: 1,
              writable: true,
            }
          );
        }
        const txcount = newStorageState.spammerAddresses?.[
          receivers[idx].sender
        ] as number;
        state = { ...(newStorageState as BotState) };
        const sigmoid = (x: number) => {
          const _x = x / 100;
          return 1 / (1 + Math.exp(-_x));
        };
        findings.push({
          name: "SAND holder received scam token",
          description: `A SAND scam token ${receivers[idx].scamToken} was sent to account holding real SAND ${account.address} from ${receivers[idx].sender}`,
          alertId: "USER-SPAMMED",
          severity: FindingSeverity.Low,
          type: FindingType.Scam,
          metadata: {
            receiver: account.address,
            scamToken: receivers[idx].scamToken,
            sender: receivers[idx].sender,
          },
          protocol: txEvent.network == 1 ? "mainnet" : "matic",
          addresses: [account.address],
          labels: [
            {
              entityType: EntityType.Address,
              entity: receivers[idx].sender,
              label: "SPAMMER",
              confidence: sigmoid(txcount),
              remove: false,
              metadata: {
                spammingToProtocol: "Sandbox",
              },
            },
          ],
          uniqueKey: "",
          source: {},
        });
      }
    });
  } else {
    console.warn("Bot runs on chain where are no legit SAND assets");
  }
  console.log("Total findings:", findings.length);
  await stateStorage.write({
    ...(state as BotState),
  });
  return findings;
};
const BOT_ID_1 =
  "0xd45f7183783f5893f4b8e187746eaf7294f73a3bb966500d237bd0d5978673fa";
const initialize: Initialize = async () => {
  await initializeMulticalls();
  const sandboxScamTokens = await findPastScamTokens("sandbox", [BOT_ID_1]);
  const sandScamTokens = await findPastScamTokens("sand", [BOT_ID_1]);
  const scamTokens = new Set<string>([...sandScamTokens, ...sandboxScamTokens]);
  const stateStorage = new JsonStorage<BotState>("./data", "state.json");
  await stateStorage.write({
    updatedAt: Date.now().toString(),
    scamTokens: Array.from(scamTokens),
    spammerAddresses: await stateStorage
      .read()
      .then((r) => r?.spammerAddresses ?? {}),
  });
  console.log("initialized agent with following known scamTokens:");
  return {
    alertConfig: {
      subscriptions: [
        {
          botId: BOT_ID_1,
          alertIds: ["SPAM-TOKEN-NEW", "PHISHING-TOKEN-NEW"],
        },
      ],
    },
  };
};

const handleAlert: HandleAlert = async (alertEvent: AlertEvent) => {
  const findings: Finding[] = [];
  const stateStorage = new JsonStorage<BotState>("./data", "state.json");
  if (alertEvent.botId === BOT_ID_1) {
    switch (alertEvent.alertId) {
      case "SPAM-TOKEN-NEW":
      case "PHISHING-TOKEN-NEW":
        const state = await stateStorage.read();

        const scamTokenSet = new Set(state?.scamTokens);
        scamTokenSet.add(alertEvent.alert?.metadata?.tokenAddress);
        stateStorage.write({
          updatedAt: Date.now().toString(),
          scamTokens: Array.from(scamTokenSet),
          spammerAddresses: { ...state?.spammerAddresses },
        });
        console.log(
          "Found new scam token:",
          alertEvent.alert.metadata.tokenAddress
        );
        console.log("new ScamToken Set length is ", scamTokenSet.size);
        break;
      default:
        console.error(
          "Unknown AlertId: ",
          alertEvent.alertId,
          "hash: ",
          alertEvent.alertHash
        );
    }
  }
  return findings;
};

// const handleBlock: HandleBlock = async (blockEvent: BlockEvent) => {
//   const findings: Finding[] = [];
//   // detect some block condition
//   return findings;
// }

// const handleAlert: HandleAlert = async (alertEvent: AlertEvent) => {
//   const findings: Finding[] = [];
//   // detect some alert condition
//   return findings;
// }

export default {
  initialize,
  handleTransaction,
  // handleBlock,
  handleAlert,
};
