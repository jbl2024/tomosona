import { describe, expect, it } from 'vitest'
import { parseFrontmatterEnvelope } from './markdownFrontmatter'

describe('parseFrontmatterEnvelope', () => {
  it('returns the body unchanged when no frontmatter exists', () => {
    expect(parseFrontmatterEnvelope('Body only')).toEqual({
      hasFrontmatter: false,
      rawYaml: '',
      body: 'Body only'
    })
  })

  it('splits simple frontmatter from the body', () => {
    expect(parseFrontmatterEnvelope('---\ntitle: Note\n---\nBody')).toEqual({
      hasFrontmatter: true,
      rawYaml: 'title: Note',
      body: 'Body'
    })
  })

  it('normalizes CRLF line endings', () => {
    expect(parseFrontmatterEnvelope('---\r\ntitle: Note\r\n---\r\nBody\r\nLine 2')).toEqual({
      hasFrontmatter: true,
      rawYaml: 'title: Note',
      body: 'Body\nLine 2'
    })
  })

  it('preserves the body even when frontmatter values are empty', () => {
    expect(parseFrontmatterEnvelope('---\n\n---\nBody')).toEqual({
      hasFrontmatter: true,
      rawYaml: '',
      body: 'Body'
    })
  })

  it('keeps the full normalized body when frontmatter is incomplete', () => {
    expect(parseFrontmatterEnvelope('---\ntitle: Note\nBody')).toEqual({
      hasFrontmatter: false,
      rawYaml: '',
      body: '---\ntitle: Note\nBody'
    })
  })
})
