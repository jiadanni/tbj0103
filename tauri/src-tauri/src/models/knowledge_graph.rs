use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum HierarchyLevel {
    Chapter,
    Section,
    Concept,
}

impl Default for HierarchyLevel {
    fn default() -> Self {
        HierarchyLevel::Concept
    }
}

impl std::fmt::Display for HierarchyLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            HierarchyLevel::Chapter => "chapter",
            HierarchyLevel::Section => "section",
            HierarchyLevel::Concept => "concept",
        };
        write!(f, "{s}")
    }
}

impl std::str::FromStr for HierarchyLevel {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "chapter" => Ok(HierarchyLevel::Chapter),
            "section" => Ok(HierarchyLevel::Section),
            _ => Ok(HierarchyLevel::Concept),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConceptType {
    Topic,
    Person,
    Technology,
    Definition,
    Question,
    Insight,
    Resource,
    Custom,
}

impl std::fmt::Display for ConceptType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            ConceptType::Topic => "topic",
            ConceptType::Person => "person",
            ConceptType::Technology => "technology",
            ConceptType::Definition => "definition",
            ConceptType::Question => "question",
            ConceptType::Insight => "insight",
            ConceptType::Resource => "resource",
            ConceptType::Custom => "custom",
        };
        write!(f, "{s}")
    }
}

impl std::str::FromStr for ConceptType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "topic" => Ok(ConceptType::Topic),
            "person" => Ok(ConceptType::Person),
            "technology" => Ok(ConceptType::Technology),
            "definition" => Ok(ConceptType::Definition),
            "question" => Ok(ConceptType::Question),
            "insight" => Ok(ConceptType::Insight),
            "resource" => Ok(ConceptType::Resource),
            "custom" => Ok(ConceptType::Custom),
            _ => Ok(ConceptType::Custom),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LinkType {
    Related,
    PartOf,
    Prerequisite,
    Contradicts,
    Supports,
    Example,
}

impl std::fmt::Display for LinkType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            LinkType::Related => "related",
            LinkType::PartOf => "part_of",
            LinkType::Prerequisite => "prerequisite",
            LinkType::Contradicts => "contradicts",
            LinkType::Supports => "supports",
            LinkType::Example => "example",
        };
        write!(f, "{s}")
    }
}

impl std::str::FromStr for LinkType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "related" => Ok(LinkType::Related),
            "part_of" => Ok(LinkType::PartOf),
            "prerequisite" => Ok(LinkType::Prerequisite),
            "contradicts" => Ok(LinkType::Contradicts),
            "supports" => Ok(LinkType::Supports),
            "example" => Ok(LinkType::Example),
            _ => Ok(LinkType::Related),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptNode {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub concept_description: String,
    pub concept_type: ConceptType,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub references: Vec<String>,
    pub x_position: f64,
    pub y_position: f64,
    pub review_count: i64,
    pub hierarchy_level: HierarchyLevel,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptLink {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub link_type: LinkType,
    pub strength: f64,
    pub context: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptMention {
    pub id: String,
    pub concept_id: String,
    pub source_type: String,
    pub source_id: String,
    pub context: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphStatistics {
    pub id: String,
    pub workspace_id: Option<String>,
    pub total_concepts: i64,
    pub total_links: i64,
    pub avg_degree: f64,
    pub density: f64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateConceptRequest {
    pub workspace_id: String,
    pub name: String,
    pub concept_description: Option<String>,
    pub concept_type: Option<ConceptType>,
    pub tags: Option<Vec<String>>,
    pub aliases: Option<Vec<String>>,
    pub hierarchy_level: Option<HierarchyLevel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLinkRequest {
    pub source_id: String,
    pub target_id: String,
    pub link_type: Option<LinkType>,
    pub strength: Option<f64>,
    pub context: Option<String>,
}

impl ConceptNode {
    pub fn new(workspace_id: impl Into<String>, name: impl Into<String>) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.into(),
            name: name.into(),
            concept_description: String::new(),
            concept_type: ConceptType::Topic,
            tags: vec![],
            aliases: vec![],
            references: vec![],
            x_position: 0.0,
            y_position: 0.0,
            review_count: 0,
            hierarchy_level: HierarchyLevel::Concept,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}
