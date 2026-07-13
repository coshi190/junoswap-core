import { createPublicClient, http } from 'viem'
import { ERC20_ABI } from '../abis/erc20.js'

const RPC_URLS: Record<number, string> = {
    25925: process.env.PONDER_RPC_URL_25925 ?? 'https://rpc-testnet.bitkubchain.io',
    96: process.env.PONDER_RPC_URL_96 ?? 'https://rpc.bitkubchain.io',
    8899: process.env.PONDER_RPC_URL_8899 ?? 'https://rpc-l1.jibchain.net',
}

const clients: Record<number, ReturnType<typeof createPublicClient>> = {}

function getClient(chainId: number) {
    if (!clients[chainId]) {
        clients[chainId] = createPublicClient({
            transport: http(RPC_URLS[chainId]),
        })
    }
    return clients[chainId]
}

export async function readERC20Metadata(
    chainId: number,
    address: string
): Promise<{ name: string; symbol: string; decimals: number }> {
    const client = getClient(chainId)
    const addr = address as `0x${string}`

    try {
        const [name, symbol, decimals] = await Promise.all([
            client.readContract({ abi: ERC20_ABI, functionName: 'name', address: addr }),
            client.readContract({ abi: ERC20_ABI, functionName: 'symbol', address: addr }),
            client.readContract({ abi: ERC20_ABI, functionName: 'decimals', address: addr }),
        ])
        return { name: name as string, symbol: symbol as string, decimals: decimals as number }
    } catch {
        return { name: '', symbol: '', decimals: 18 }
    }
}
