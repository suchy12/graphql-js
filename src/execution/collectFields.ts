import type { ObjMap } from '../jsutils/ObjMap';

import type {
  SelectionSetNode,
  FieldNode,
  FragmentSpreadNode,
  InlineFragmentNode,
  FragmentDefinitionNode,
} from '../language/ast';
import { Kind } from '../language/kinds';

import type { GraphQLSchema } from '../type/schema';
import type { GraphQLObjectType } from '../type/definition';
import {
  GraphQLIncludeDirective,
  GraphQLSkipDirective,
  GraphQLDeferDirective,
} from '../type/directives';
import { isAbstractType } from '../type/definition';

import { typeFromAST } from '../utilities/typeFromAST';

import { getDirectiveValues } from './values';

export interface PatchFields {
  label?: string;
  fields: Map<string, ReadonlyArray<FieldNode>>;
}

export interface FieldsAndPatches {
  fields: Map<string, ReadonlyArray<FieldNode>>;
  patches: Array<PatchFields>;
}

/**
 * Given a selectionSet, adds all of the fields in that selection to
 * the passed in map of fields, and returns it at the end.
 *
 * CollectFields requires the "runtime type" of an object. For a field which
 * returns an Interface or Union type, the "runtime type" will be the actual
 * Object type returned by that field.
 *
 * @internal
 */
export function collectFields(
  schema: GraphQLSchema,
  fragments: ObjMap<FragmentDefinitionNode>,
  variableValues: { [variable: string]: unknown },
  runtimeType: GraphQLObjectType,
  selectionSet: SelectionSetNode,
  fields: Map<string, Array<FieldNode>>,
  patches: Array<PatchFields>,
  visitedFragmentNames: Set<string>,
): FieldsAndPatches {
  for (const selection of selectionSet.selections) {
    switch (selection.kind) {
      case Kind.FIELD: {
        if (!shouldIncludeNode(variableValues, selection)) {
          continue;
        }
        const name = getFieldEntryKey(selection);
        const fieldList = fields.get(name);
        if (fieldList !== undefined) {
          fieldList.push(selection);
        } else {
          fields.set(name, [selection]);
        }
        break;
      }
      case Kind.INLINE_FRAGMENT: {
        if (
          !shouldIncludeNode(variableValues, selection) ||
          !doesFragmentConditionMatch(schema, selection, runtimeType)
        ) {
          continue;
        }

        const defer = getDeferValues(variableValues, selection);

        if (defer) {
          const { fields: patchFields } = collectFields(
            schema,
            fragments,
            variableValues,
            runtimeType,
            selection.selectionSet,
            new Map(),
            patches,
            visitedFragmentNames,
          );
          patches.push({
            label: defer.label,
            fields: patchFields,
          });
        } else {
          collectFields(
            schema,
            fragments,
            variableValues,
            runtimeType,
            selection.selectionSet,
            fields,
            patches,
            visitedFragmentNames,
          );
        }
        break;
      }
      case Kind.FRAGMENT_SPREAD: {
        const fragName = selection.name.value;

        if (!shouldIncludeNode(variableValues, selection)) {
          continue;
        }

        const defer = getDeferValues(variableValues, selection);
        if (visitedFragmentNames.has(fragName) && !defer) {
          continue;
        }

        const fragment = fragments[fragName];
        if (
          !fragment ||
          !doesFragmentConditionMatch(schema, fragment, runtimeType)
        ) {
          continue;
        }
        visitedFragmentNames.add(fragName);

        if (defer) {
          const { fields: patchFields } = collectFields(
            schema,
            fragments,
            variableValues,
            runtimeType,
            fragment.selectionSet,
            new Map(),
            patches,
            visitedFragmentNames,
          );
          patches.push({
            label: defer.label,
            fields: patchFields,
          });
        } else {
          collectFields(
            schema,
            fragments,
            variableValues,
            runtimeType,
            fragment.selectionSet,
            fields,
            patches,
            visitedFragmentNames,
          );
        }
        break;
      }
    }
  }
  return { fields, patches };
}

/**
 * Returns an object containing the `@defer` arguments if a field should be
 * deferred based on the experimental flag, defer directive present and
 * not disabled by the "if" argument.
 */
function getDeferValues(
  variableValues: { [variable: string]: unknown },
  node: FragmentSpreadNode | InlineFragmentNode,
): undefined | { label?: string } {
  const defer = getDirectiveValues(GraphQLDeferDirective, node, variableValues);

  if (!defer) {
    return;
  }

  if (defer.if === false) {
    return;
  }

  return {
    label: typeof defer.label === 'string' ? defer.label : undefined,
  };
}

/**
 * Determines if a field should be included based on the `@include` and `@skip`
 * directives, where `@skip` has higher precedence than `@include`.
 */
function shouldIncludeNode(
  variableValues: { [variable: string]: unknown },
  node: FragmentSpreadNode | FieldNode | InlineFragmentNode,
): boolean {
  const skip = getDirectiveValues(GraphQLSkipDirective, node, variableValues);
  if (skip?.if === true) {
    return false;
  }

  const include = getDirectiveValues(
    GraphQLIncludeDirective,
    node,
    variableValues,
  );
  if (include?.if === false) {
    return false;
  }
  return true;
}

/**
 * Determines if a fragment is applicable to the given type.
 */
function doesFragmentConditionMatch(
  schema: GraphQLSchema,
  fragment: FragmentDefinitionNode | InlineFragmentNode,
  type: GraphQLObjectType,
): boolean {
  const typeConditionNode = fragment.typeCondition;
  if (!typeConditionNode) {
    return true;
  }
  const conditionalType = typeFromAST(schema, typeConditionNode);
  if (conditionalType === type) {
    return true;
  }
  if (isAbstractType(conditionalType)) {
    return schema.isSubType(conditionalType, type);
  }
  return false;
}

/**
 * Implements the logic to compute the key of a given field's entry
 */
function getFieldEntryKey(node: FieldNode): string {
  return node.alias ? node.alias.value : node.name.value;
}