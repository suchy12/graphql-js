// @flow strict

import { describe, it } from 'mocha';

import { NoUnusedFragments } from '../rules/NoUnusedFragments';

import { expectValidationErrors } from './harness';

function expectErrors(queryStr) {
  return expectValidationErrors(NoUnusedFragments, queryStr);
}

function expectValid(queryStr) {
  expectErrors(queryStr).to.deep.equal([]);
}

describe('Validate: No unused fragments', () => {
  it('all fragment names are used', () => {
    expectValid(`
      {
        human(id: 4) {
          ...HumanFields1
          ... on Human {
            ...HumanFields2
          }
        }
      }
      fragment HumanFields1 on Human {
        name
        ...HumanFields3
      }
      fragment HumanFields2 on Human {
        name
      }
      fragment HumanFields3 on Human {
        name
      }
    `);
  });

  it('all fragment names are used by multiple operations', () => {
    expectValid(`
      query Foo {
        human(id: 4) {
          ...HumanFields1
        }
      }
      query Bar {
        human(id: 4) {
          ...HumanFields2
        }
      }
      fragment HumanFields1 on Human {
        name
        ...HumanFields3
      }
      fragment HumanFields2 on Human {
        name
      }
      fragment HumanFields3 on Human {
        name
      }
    `);
  });

  it('contains unknown fragments', () => {
    expectErrors(`
      query Foo {
        human(id: 4) {
          ...HumanFields1
        }
      }
      query Bar {
        human(id: 4) {
          ...HumanFields2
        }
      }
      fragment HumanFields1 on Human {
        name
        ...HumanFields3
      }
      fragment HumanFields2 on Human {
        name
      }
      fragment HumanFields3 on Human {
        name
      }
      fragment Unused1 on Human {
        name
      }
      fragment Unused2 on Human {
        name
      }
    `).to.deep.equal([
      {
        message: 'Fragment "Unused1" is never used.',
        locations: [{ line: 22, column: 7 }],
      },
      {
        message: 'Fragment "Unused2" is never used.',
        locations: [{ line: 25, column: 7 }],
      },
    ]);
  });

  it('contains unknown fragments with ref cycle', () => {
    expectErrors(`
      query Foo {
        human(id: 4) {
          ...HumanFields1
        }
      }
      query Bar {
        human(id: 4) {
          ...HumanFields2
        }
      }
      fragment HumanFields1 on Human {
        name
        ...HumanFields3
      }
      fragment HumanFields2 on Human {
        name
      }
      fragment HumanFields3 on Human {
        name
      }
      fragment Unused1 on Human {
        name
        ...Unused2
      }
      fragment Unused2 on Human {
        name
        ...Unused1
      }
    `).to.deep.equal([
      {
        message: 'Fragment "Unused1" is never used.',
        locations: [{ line: 22, column: 7 }],
      },
      {
        message: 'Fragment "Unused2" is never used.',
        locations: [{ line: 26, column: 7 }],
      },
    ]);
  });

  it('contains unknown and undef fragments', () => {
    expectErrors(`
      query Foo {
        human(id: 4) {
          ...bar
        }
      }
      fragment foo on Human {
        name
      }
    `).to.deep.equal([
      {
        message: 'Fragment "foo" is never used.',
        locations: [{ line: 7, column: 7 }],
      },
    ]);
  });
});