import axios from "axios";
import { ethers, getEthersProvider } from "forta-agent";
import {
  MulticallProvider,
  MulticallContract,
  createAddress,
} from "forta-agent-tools";

const mainnetProvider = new ethers.providers.JsonRpcProvider(
  process.env.JSON_RPC_MAINNET
);
const polygonProvider = new ethers.providers.JsonRpcProvider(
  process.env.JSON_RPC_MATIC
);
const multicallProviderEth = new MulticallProvider(mainnetProvider, 1);
const multicallProviderMatic = new MulticallProvider(polygonProvider, 137);
export const ethAddressRegex = /(0x[a-f0-9]{40})/g;
export const findPastScamTokens = async (query: string, botIds: string[]) => {
  const limit = 100;
  let alertNmbr = 0;
  let pageValues = undefined;
  let scamTokens = new Set<string>();
  do {
    const result: any = await axios.post(
      "https://explorer-api.forta.network/graphql",
      {
        query: `query RetrieveAlerts($getListInput: GetAlertsInput) {
              getList(input: $getListInput) {
                alerts {
                  hash
                  description
                  severity
                  protocol
                  name
                  alert_id
                  scanner_count
                  alert_document_type
                  source {
                    tx_hash
                    agent {
                      id
                      name
                      __typename
                    }
                    block {
                      chain_id
                      number
                      timestamp
                      __typename
                    }
                    source_alert {
                      hash
                      timestamp
                      __typename
                    }
                    __typename
                  }
                  __typename
                }
                nextPageValues {
                  timestamp
                  id
                  __typename
                }
                currentPageValues {
                  timestamp
                  id
                  __typename
                }
                __typename
              }
            }
            `,
        variables: {
          getListInput: {
            severity: [],
            addresses: [],
            text: `${query}`,
            agents: `${JSON.stringify(botIds)}`,
            sort: "desc",
            muted: [],
            txHash: "",
            limit: limit,
            pageValues: pageValues,
          },
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    const getList = result.data.data?.getList;
    // console.log(result.data.data.getList);
    if (getList) {
      alertNmbr = getList.alerts.length;
      pageValues = {
        id: getList.nextPageValues.id,
        timestamp: getList.nextPageValues.timestamp,
      };
      console.log("got list:", alertNmbr);

      await getList.alerts.forEach(async (alert: any) => {
        alert.description
          .match(ethAddressRegex)
          .forEach((address: string, idx: number) => {
            scamTokens.add(address);
            if (idx > 0) {
              //This is a quick hacky solution to get token addresses
              //Propper approach would be to query each alert trough
              // query Retrive($getScannerAlertsInput: GetScannerAlertsInput)
              // By alert.hash. If we start seeing these warnings - it's a sign to implement proper querying
              console.warn(
                "findPastScamTokens: Unexpected number of accounts found in alert description"
              );
            }
          });

        // console.log(
        //   JSON.stringify({
        //     hash: alert.hash,
        //     blockTimestamp: alert.source.block.timestamp,
        //     description: alert.description,
        //     botId: alert.source.agent.id,
        //     network: alert.source.block.chain_id,
        //     name: alert.name,
        //     alertId: alert.alert_id,
        //     alertTimestamp: alert.source.source_alert.timestamp,
        //   })
        // );
      });
    } else {
      console.log("List is empty");
      alertNmbr = 0;
    }
    console.log("page over..");
  } while (alertNmbr === limit);
  return scamTokens;
};

const token = new MulticallContract(createAddress("0x0"), [
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
]);

export async function initializeMulticalls() {
  if (!process.env.JSON_RPC_MAINNET || !process.env.JSON_RPC_MATIC)
    throw new Error("RPC envs not set");
  // fetches the provider network and loads an appropriate Multicall2 address
  // throws if the network is not supported
  //   await multicallProviderEth.init();
  //   await multicallProviderMatic.init();
}

export async function getERC20Holders(
  contractAddressMainnet: string,
  contractAddressPolygon: string,
  addresses: string[]
) {
  const tokenMainnet = new MulticallContract(contractAddressMainnet, [
    "function balanceOf(address account) external view returns (uint256)",
  ]);
  const tokenPolygon = new MulticallContract(contractAddressPolygon, [
    "function balanceOf(address account) external view returns (uint256)",
  ]);

  const callsMainnet = addresses.map((address) =>
    tokenMainnet.balanceOf(address)
  );
  const callsPolygon = addresses.map((address) =>
    tokenPolygon.balanceOf(address)
  );
  console.log("Fetching balances of", addresses.length, " addresses");

  const balancesEth = await multicallProviderEth.tryAll(callsMainnet);
  const balancesMatic = await multicallProviderMatic.tryAll(callsPolygon);
  if (
    balancesMatic.some((p) => !p.success) ||
    balancesEth.some((p) => !p.success)
  ) {
    console.error(
      "Some addresses erc20 balances could not be multicall fetched"
    );
    console.log(balancesEth.filter((p) => !p.success));
    console.log(balancesMatic.filter((p) => !p.success));
  }
  return addresses.map((a, idx) => {
    return {
      address: a,
      isHolder:
        balancesEth[idx].returnData?.gt(0) ||
        balancesMatic[idx].returnData?.gt("0"),
    };
  });
}
