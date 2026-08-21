import zod from "zod";

export const scopes = {
  teams: {
    read: {
      name: "teams:read",
      description: "Read team information"
    },
    invites: {
      read: {
        name: "teams:invites:read",
        description: "Get all pending team invites"
      },
      send: {
        name: "teams:invites:send",
        description: "Send a team invite"
      },
      cancel: {
        name: "teams:invites:cancel",
        description: "Cancel a team invite"
      }
    }
  },
  materials: {
    read: {
      name: "materials:read",
      description: "Read team materials"
    },
    write: {
      name: "materials:write",
      description: "Create, update, or delete a team material"
    }
  },
  machines: {
    read: {
      name: "machines:read",
      description: "Read team machines"
    },
    write: {
      name: "machines:write",
      description: "Create, update, or delete a team machine"
    }
  },
  tools: {
    read: {
      name: "tools:read",
      description: "Read team tools"
    },
    write: {
      name: "tools:write",
      description: "Create, update, or delete a team tool"
    }
  },
  pc: {
    read: {
      name: "part_categories:read",
      description: "Read team part categories"
    },
    write: {
      name: "part_categories:write",
      description: "Create, update, or delete team part categories"
    },
    assignments: {
      read: {
        name: "part_categories:assignments:read",
        description: "Read team part -> plate assignments"
      },
      write: {
        name: "part_categories:assignments:write",
        description: "Create, update or delete team part -> plate assignments"
      }
    }
  },
  parts: {
    read: {
      name: "parts:read",
      description: "Read team parts"
    },
    write: {
      name: "parts:write",
      description: "Create, update, or delete team parts"
    }
  },
  plates: {
    read: {
      name: "plates:read",
      description: "Read team plates"
    },
    write: {
      name: "plates:write",
      description: "Create, update, or delete team plates"
    }
  },
  boxTubes: {
    read: {
      name: "box_tubes:read",
      description: "Read team box tubes"
    },
    write: {
      name: "box_tubes:write",
      description: "Create, update, or delete team box tubes"
    }
  },
  drafts: {
    read: {
      name: "drafts:read",
      description: "Read team drafts (incomplete uploads)"
    },
    write: {
      name: "drafts:write",
      description: "Create, update, or delete team drafts"
    }
  },
  jobs: {
    read: {
      name: "jobs:read",
      description: "Read all jobs for a team"
    },
    create: {
      name: "jobs:create",
      description: "Create a job for a team"
    },
    process: {
      name: "jobs:process",
      description: "Process a job (for runners)"
    },
    delete: {
      name: "jobs:delete",
      description: "Delete a job"
    }
  }
};

export interface ScopeLeaf {
  name: string;
  description: string;
};

export interface ScopeTree {
  [key: string]: ScopeLeaf | ScopeTree;
};

type ScopeNameTree<T> = {
  [K in keyof T]:
    T[K] extends ScopeLeaf ? T[K]["name"] : ScopeNameTree<T[K]>
};

function getScopeNames<T extends ScopeTree>(tree: T): ScopeNameTree<T> {
  const result: Record<string, unknown> = {}
  for (const key in tree) {
    const value = tree[key];
    if (typeof value === "object" && value && "name" in value)
      result[key] = value.name;
    else
      result[key] = getScopeNames(value);
  }
  return result as ScopeNameTree<T>;
}

export const scopeNames = getScopeNames(scopes);

function flattenScopes<T>(tree: ScopeNameTree<T>): string[] {
  return Object.values(tree).flatMap(value => 
    typeof value === "object" && value ? flattenScopes(value) : value
  ) as string[];
}

export const ScopeEnum = zod.enum(flattenScopes(scopeNames));