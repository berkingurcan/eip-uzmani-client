import { kv } from '@vercel/kv'
import { NextRequest } from 'next/server'
import { OpenAIStream, StreamingTextResponse, VercelChatMessage } from 'ai'
import { Configuration, OpenAIApi } from 'openai-edge'

import { ChatOpenAI } from 'langchain/chat_models/openai'
import { BytesOutputParser } from 'langchain/schema/output_parser'
import { PromptTemplate } from 'langchain/prompts'

import { auth } from '@/auth'
import { nanoid } from '@/lib/utils'

export const runtime = 'edge'

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})

const formatMessage = (message: VercelChatMessage) => {
  return `${message.role}: ${message.content}`
}

const TEMPLATE = `You are a Senior Blockchain Developer who has great knowledge about Ethereum Improvement Proposals. 
You are helping people about Ethereum, Solidity, EIP's etc. If you don't have the asked information, just say the truth.
 
Current conversation:
{chat_history}
 
User: {input}
AI:`

const openai = new OpenAIApi(configuration)

export async function POST(req: Request) {
  const json = await req.json()
  const { messages, previewToken } = json
  const formattedPreviousMessages = messages.slice(0, -1).map(formatMessage)
  const currentMessageContent = messages[messages.length - 1].content
  const userId = (await auth())?.user.id

  const prompt = PromptTemplate.fromTemplate(TEMPLATE)

  const model = new ChatOpenAI({
    temperature: 0.8
  })

  const outputParser = new BytesOutputParser()

  if (!userId) {
    return new Response('Unauthorized', {
      status: 401
    })
  }

  if (previewToken) {
    configuration.apiKey = previewToken
  }

  const res = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo',
    messages,
    temperature: 0.7,
    stream: true
  })

  const chain = prompt.pipe(model).pipe(outputParser)
 
  const stream = await chain.stream({
    chat_history: formattedPreviousMessages.join('\n'),
    input: currentMessageContent
  })

  const title = json.messages[0].content.substring(0, 100)
      const id = json.id ?? nanoid()
      const createdAt = Date.now()
      const path = `/chat/${id}`
      const payload = {
        id,
        title,
        userId,
        createdAt,
        path,
        messages: [
          ...messages,
          {
            content: currentMessageContent,
            role: 'assistant'
          }
        ]
      }
      await kv.hmset(`chat:${id}`, payload)
      await kv.zadd(`user:chat:${userId}`, {
        score: createdAt,
        member: `chat:${id}`
      })
 
  return new StreamingTextResponse(stream)
}
