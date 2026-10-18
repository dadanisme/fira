import { deleteField, getDocs, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { useMemo } from 'react';
import { DEFAULT_COLUMN_NAMES, type Column, type FieldDef, type Project } from '@shared/types';
import { isProjectKey } from '@shared/keys';
import { byRank, rankAfterLast } from '@shared/rank';
import { randomId } from '@shared/ids';
import { newDoc, projectsCol, rawDoc, type Stored } from './db';
import { useLiveQuery, type Live } from './live';

const allProjects = query(projectsCol);

/** All projects, sorted by rank. */
export function useProjects(): Live<Project[]> {
  const live = useLiveQuery(allProjects);
  const data = useMemo(() => [...live.data].sort(byRank), [live.data]);
  return { ...live, data };
}

/** A project by key (derived from useProjects; shares its listener). */
export function useProject(key: string | undefined): Live<Project | null> {
  const live = useProjects();
  const upper = key?.toUpperCase();
  return { ...live, data: live.data.find((p) => p.key === upper) ?? null };
}

export function newColumn(name: string): Column {
  return { id: randomId(8), name };
}

export function newFieldDef(def: Omit<FieldDef, 'id'>): FieldDef {
  return { ...def, id: randomId(8) };
}

/** Creates a project with the default columns; resolves to its key. Throws if the key is invalid or taken. */
export async function createProject(input: { key: string; name: string }): Promise<string> {
  const key = input.key.trim().toUpperCase();
  if (!isProjectKey(key)) throw new Error('Key must be 2–10 uppercase letters or digits, starting with a letter');
  const existing = (await getDocs(allProjects)).docs.map((d) => d.data());
  if (existing.some((p) => p.key === key)) throw new Error(`Project key ${key} is already used`);

  const ref = newDoc('projects');
  const project: Stored<Project, 'createdAt'> = {
    key,
    name: input.name.trim() || key,
    columns: DEFAULT_COLUMN_NAMES.map(newColumn),
    fields: [],
    nextNumber: 1,
    rank: rankAfterLast(existing),
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, project);
  return key;
}

export interface ProjectPatch {
  name?: string;
  columns?: Column[];
  fields?: FieldDef[];
  rank?: string;
  /** null clears. */
  pageTemplateId?: string | null;
  pageParentId?: string | null;
}

/** Updates project settings. The key is immutable (it is part of every card key). */
export function updateProject(id: string, patch: ProjectPatch): Promise<void> {
  const data = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === null ? deleteField() : v]));
  return updateDoc(rawDoc('projects', id), data);
}
