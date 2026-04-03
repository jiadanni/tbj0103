// modules/sidebar/features/related-content/source-config.js
//
// Configuration for related data sources (Jira, Confluence, Knowledge Base).

/**
 * Configuration for various data sources that the sidebar can preload.
 */
export const PRELOAD_CONFIG = {
    jira: {
        label: 'JIRA tickets',
        listSelector: '#jira-list',
        sectionSelector: '#jira-tickets',
        displayName: 'Work Items',
        loadingMessage: 'Loading JIRA tickets...',
        responseKey: 'tickets',
        actionBuilder: (caseData, isManualFetch) => ({
            action: 'getRelatedJiraTickets',
            caseId: caseData.caseId || caseData.id || '',
            caseData,
            isManualFetch
        })
    },
    confluence: {
        label: 'Confluence pages',
        listSelector: '#confluence-list',
        sectionSelector: '#confluence-pages',
        displayName: 'Confluence articles',
        loadingMessage: 'Loading Confluence pages...',
        responseKey: 'pages',
        actionBuilder: (caseData, isManualFetch) => ({
            action: 'getRelatedConfluencePages',
            caseData,
            isManualFetch
        })
    },
    community: {
        label: 'Knowledge Base',
        listSelector: '#community-list',
        sectionSelector: '#community-guides',
        displayName: 'Knowledge Base',
        loadingMessage: 'Loading Knowledge Base results...',
        responseKey: 'guides',
        actionBuilder: (caseData, isManualFetch) => ({
            action: 'getRelatedCommunityGuides',
            caseData,
            isManualFetch
        })
    }
};
