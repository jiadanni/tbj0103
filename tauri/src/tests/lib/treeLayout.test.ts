import { describe, it, expect } from 'vitest';

import {
  buildTreeFromLinks,
  selectRootNode,
  isTreeLink,
  filterAdditionalLinks,
  estimateOptimalRadius,
  type TreeNode
} from '../../lib/treeLayout';

describe('treeLayout', () => {
  const nodes = [
    { id: '1', name: 'Root', hierarchy_level: 'chapter' },
    { id: '2', name: 'Child 1', hierarchy_level: 'concept' },
    { id: '3', name: 'Child 2', hierarchy_level: 'concept' },
    { id: '4', name: 'Grandchild', hierarchy_level: 'concept' },
  ];

  const links = [
    { source_id: '1', target_id: '2', link_type: 'part_of' },
    { source_id: '1', target_id: '3', link_type: 'part_of' },
    { source_id: '2', target_id: '4', link_type: 'part_of' },
    { source_id: '3', target_id: '4', link_type: 'related' },
  ];

  describe('buildTreeFromLinks', () => {
    it('builds a tree correctly using part_of links', () => {
      const tree = buildTreeFromLinks(nodes, links, '1');

      expect(tree.id).toBe('1');
      expect(tree.children?.length).toBe(2);

      const child1 = tree.children?.find(c => c.id === '2');
      const child2 = tree.children?.find(c => c.id === '3');

      expect(child1).toBeDefined();
      expect(child2).toBeDefined();

      expect(child1?.children?.length).toBe(1);
      expect(child1?.children?.[0].id).toBe('4');

      expect(child2?.children?.length).toBe(0);
    });

    it('returns dummy node if root not found', () => {
      const tree = buildTreeFromLinks(nodes, links, 'missing');
      expect(tree.id).toBe('missing');
      expect(tree.name).toBe('Unknown');
      expect(tree.children?.length).toBe(0);
    });
  });

  describe('selectRootNode', () => {
    it('uses overrideRootId if valid', () => {
      expect(selectRootNode(nodes, links, '3')).toBe('3');
    });

    it('falls back if overrideRootId is invalid', () => {
      expect(selectRootNode(nodes, links, 'missing')).toBe('1');
    });

    it('selects first chapter level with no parent', () => {
      expect(selectRootNode(nodes, links)).toBe('1');
    });

    it('falls back to first top-level node with no parent if no chapters exist', () => {
      const customNodes = [
        { id: 'a', name: 'A', hierarchy_level: 'concept' },
        { id: 'b', name: 'B', hierarchy_level: 'concept' },
      ];
      const customLinks = [{ source_id: 'a', target_id: 'b', link_type: 'part_of' }];
      expect(selectRootNode(customNodes, customLinks)).toBe('a');
    });
  });

  describe('isTreeLink', () => {
    it('returns true only for part_of links', () => {
      expect(isTreeLink({ link_type: 'part_of' })).toBe(true);
      expect(isTreeLink({ link_type: 'related' })).toBe(false);
      expect(isTreeLink({ link_type: 'prerequisite' })).toBe(false);
    });
  });

  describe('filterAdditionalLinks', () => {
    it('filters out part_of links', () => {
      const filtered = filterAdditionalLinks(links);
      expect(filtered.length).toBe(1);
      expect(filtered[0].link_type).toBe('related');
    });
  });

  describe('estimateOptimalRadius', () => {
    it('returns compact radius for small depths', () => {
      const tree: TreeNode = {
        id: '1', name: 'Root', hierarchy_level: 'chapter',
        children: [{ id: '2', name: 'Child 1', hierarchy_level: 'concept', children: [] }]
      };
      expect(estimateOptimalRadius(tree)).toBe(120);
    });

    it('returns balanced radius for medium depths', () => {
      const tree: TreeNode = {
        id: '1', name: '1', hierarchy_level: 'c',
        children: [{
          id: '2', name: '2', hierarchy_level: 'c',
          children: [{ id: '3', name: '3', hierarchy_level: 'c', children: [] }]
        }]
      };
      expect(estimateOptimalRadius(tree)).toBe(200);
    });

    it('returns spacious radius for large depths', () => {
      const tree: TreeNode = {
        id: '1', name: '1', hierarchy_level: 'c',
        children: [{
          id: '2', name: '2', hierarchy_level: 'c',
          children: [{
            id: '3', name: '3', hierarchy_level: 'c',
            children: [{
              id: '4', name: '4', hierarchy_level: 'c',
              children: [{ id: '5', name: '5', hierarchy_level: 'c', children: [] }]
            }]
          }]
        }]
      };
      expect(estimateOptimalRadius(tree)).toBe(280);
    });
  });
});
