import type { TSESTree } from '@typescript-eslint/types'
import type { SortingNode } from '../typings'

import { AST_NODE_TYPES } from '@typescript-eslint/types'

import { createEslintRule } from '../utils/create-eslint-rule'
import { rangeToDiff } from '../utils/range-to-diff'
import { SortType, SortOrder } from '../typings'
import { sortNodes } from '../utils/sort-nodes'
import { makeFixes } from '../utils/make-fixes'
import { complete } from '../utils/complete'
import { pairwise } from '../utils/pairwise'
import { groupBy } from '../utils/group-by'
import { compare } from '../utils/compare'

type MESSAGE_ID = 'unexpectedJSXPropsOrder'

export enum Position {
  'first' = 'first',
  'last' = 'last',
  'ignore' = 'ignore',
}

type SortingNodeWithPosition = SortingNode & { position: Position }

type Options = [
  Partial<{
    order: SortOrder
    type: SortType
    'ignore-case': boolean
    shorthand: Position
    callback: Position
    multiline: Position
  }>,
]

export const RULE_NAME = 'sort-jsx-props'

export default createEslintRule<Options, MESSAGE_ID>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description: 'enforce sorted JSX props',
      recommended: false,
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          type: {
            enum: [
              SortType.alphabetical,
              SortType.natural,
              SortType['line-length'],
            ],
            default: SortType.natural,
          },
          order: {
            enum: [SortOrder.asc, SortOrder.desc],
            default: SortOrder.asc,
          },
          'ignore-case': {
            type: 'boolean',
            default: false,
          },
          shorthand: {
            enum: [Position.first, Position.last, Position.ignore],
          },
          callback: {
            enum: [Position.first, Position.last, Position.ignore],
          },
          multiline: {
            enum: [Position.first, Position.last, Position.ignore],
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unexpectedJSXPropsOrder:
        'Expected "{{second}}" to come before "{{first}}"',
    },
  },
  defaultOptions: [
    {
      type: SortType.alphabetical,
      order: SortOrder.asc,
    },
  ],
  create: context => ({
    JSXElement: node => {
      let options = complete(context.options.at(0), {
        type: SortType.alphabetical,
        shorthand: Position.ignore,
        multiline: Position.ignore,
        callback: Position.ignore,
        'ignore-case': false,
        order: SortOrder.asc,
      })

      let source = context.getSourceCode()

      let parts: SortingNodeWithPosition[][] =
        node.openingElement.attributes.reduce(
          (
            accumulator: SortingNodeWithPosition[][],
            attribute: TSESTree.JSXSpreadAttribute | TSESTree.JSXAttribute,
          ) => {
            if (attribute.type === AST_NODE_TYPES.JSXSpreadAttribute) {
              accumulator.push([])
              return accumulator
            }

            let position: Position = Position.ignore

            if (
              options.shorthand !== Position.ignore &&
              attribute.value === null
            ) {
              position = options.shorthand
            }

            if (
              options.callback !== Position.ignore &&
              attribute.name.type === AST_NODE_TYPES.JSXIdentifier &&
              attribute.name.name.indexOf('on') === 0 &&
              attribute.value !== null
            ) {
              position = options.callback
            } else if (
              options.multiline !== Position.ignore &&
              attribute.loc.start.line !== attribute.loc.end.line
            ) {
              position = options.multiline
            }

            let jsxNode = {
              name:
                attribute.name.type === AST_NODE_TYPES.JSXNamespacedName
                  ? `${attribute.name.namespace.name}:${attribute.name.name.name}`
                  : attribute.name.name,
              size: rangeToDiff(attribute.range),
              node: attribute,
              position,
            }

            accumulator.at(-1)!.push(jsxNode)

            return accumulator
          },
          [[]],
        )

      parts.forEach(nodes => {
        pairwise(nodes, (first, second) => {
          let comparison: boolean

          if (first.position === second.position) {
            comparison = compare(first, second, options)
          } else {
            let positionPower = {
              [Position.first]: 1,
              [Position.ignore]: 0,
              [Position.last]: -1,
            }

            comparison =
              positionPower[first.position] < positionPower[second.position]
          }

          if (comparison) {
            context.report({
              messageId: 'unexpectedJSXPropsOrder',
              data: {
                first: first.name,
                second: second.name,
              },
              node: second.node,
              fix: fixer => {
                let groups = groupBy(nodes, ({ position }) => position)

                let getGroup = (index: string) =>
                  index in groups ? groups[index] : []

                let sortedNodes = [
                  sortNodes(getGroup(Position.first), options),
                  sortNodes(getGroup(Position.ignore), options),
                  sortNodes(getGroup(Position.last), options),
                ].flat()

                return makeFixes(fixer, nodes, sortedNodes, source)
              },
            })
          }
        })
      })
    },
  }),
})
